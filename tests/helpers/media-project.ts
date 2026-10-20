import { execCommand } from './command.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test as base, expect } from './project.js';
import type { SpeechRuntime } from '../../src/business/speech.js';

export type MediaFiles = { video: string; audio: Buffer };
export type SpeechControl = {
  mode: 'success' | 'failure' | 'unknown' | 'pending';
  requests: { text: string; requestId: string | null }[];
  release(): void;
  runtime: SpeechRuntime;
};

/** 供应商是唯一受控边界；任务、输入快照、媒体文件和播放器均使用真实产品路径。 */
export const test = base.extend<{ mediaFiles: MediaFiles; speechControl: SpeechControl }>({
  mediaFiles: async ({}, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'clapgrid-media-input-'));
    let commandsExited = false;
    try {
      const video = join(directory, '实际素材.mp4');
      const audio = join(directory, 'speech.mp3');
      await execCommand('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
      await execCommand('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'libmp3lame', audio]);
      commandsExited = true;
      await use({ video, audio: await readFile(audio) });
    } finally {
      if (commandsExited) await rm(directory, { recursive: true, force: true });
      else console.error(`媒体命令未确认完成，保留输入目录 ${directory}`);
    }
  },
  speechControl: async ({ mediaFiles }, use) => {
    const pending = new Set<() => void>();
    const response = () => new Response(`data: ${JSON.stringify({ code: 0, data: mediaFiles.audio.toString('base64') })}\n\ndata: {"code":20000000}\n\n`);
    const control: SpeechControl = {
      mode: 'success', requests: [], release: () => { for (const finish of pending) finish(); pending.clear(); },
      runtime: { key: () => 'controlled-provider', configPath: '/controlled/TokenDance.env', fetch: async (_, options) => {
        const input = JSON.parse(String(options?.body)) as { req_params: { text: string } };
        control.requests.push({ text: input.req_params.text, requestId: new Headers(options?.headers).get('X-Api-Request-Id') });
        if (control.mode === 'failure') return new Response('不回显供应商正文', { status: 401 });
        if (control.mode === 'unknown') return new Response('data: {"code":0,"data":"SUQz"}\n\n');
        if (control.mode === 'pending') await new Promise<void>((resolve, reject) => {
          pending.add(resolve);
          options?.signal?.addEventListener('abort', () => { pending.delete(resolve); reject(Error('已取消的测试供应商请求')); }, { once: true });
        });
        return response();
      } },
    };
    try { await use(control); } finally { control.release(); }
  },
  speechRuntime: async ({ speechControl }, use) => { await use(speechControl.runtime); },
});
export { expect };
