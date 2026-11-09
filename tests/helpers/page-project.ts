import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cpSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { queryStatus, queryVisualContext } from '../../src/shared/client.js';
import type { ResourceFixtures } from './resource-test.js';
import type { ExportTask, SpeechTimestamp, VisualPlan } from '../../src/shared/contracts.js';

export async function pageProject(resources: Pick<ResourceFixtures, 'createDirectory' | 'execBytes' | 'startService'>, audioDuration = 1, styled = false, text = '页面合成', words?: SpeechTimestamp[]) {
  const root = resources.createDirectory(join(tmpdir(), 'clapgrid-page-render-'));
  const audio = join(root, 'voice.mp3');
  await resources.execBytes('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=duration=${audioDuration}`, '-c:a', 'libmp3lame', audio]);
  const bytes = readFileSync(audio).toString('base64');
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'panel');
  const speechFrames = [{ code: 0, data: bytes, ...(words && { sentence: { words } }) }, { code: 20000000 }];
  const options = { projectDirectory: join(root, 'project'), panelDirectory, port: 0, speechRuntime: { configPath: '.env', key: () => 'test', fetch: (async () => new Response(speechFrames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(''))) as typeof fetch } };
  const service = await resources.startService(options);
  const post = async (path: string, input: unknown) => {
    const r = await fetch(service.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const body = await r.json(); expect(r.status, JSON.stringify(body)).toBe(200); return body;
  };
  await post('/api/codex/modify', { changes: [{ kind: 'add', text }] });
  const segmentId = (await queryStatus(service.url)).snapshot.segments[0]!.id;
  await post('/api/speech/submit', { requestId: randomUUID(), segmentId });
  await expect.poll(async () => (await fetch(service.url + '/api/speech').then(r => r.json())).audio.length).toBe(1);
  await post('/api/codex/export-settings', { expected: (await queryStatus(service.url)).snapshot.exportSettings, settings: { codec: 'libx264', fps: 25 } });
  const styleDirectory = join(root, 'style');
  cpSync(new URL('../fixtures/style', import.meta.url), styleDirectory, { recursive: true });
  async function setStyle(sourceDirectory: string | null) {
    const expected = (await queryStatus(service.url)).snapshot.projectStyle?.styleId ?? null;
    const styleId = sourceDirectory ? (await post('/api/codex/import-style', { sourceDirectory })).style.styleId : null;
    await post('/api/codex/project-style', { expected, styleId });
    return styleId;
  }
  if (styled) await setStyle(styleDirectory);
  const context = await queryVisualContext(service.url, segmentId);
  async function importPage(script: string) {
    const sourceDirectory = join(root, randomUUID()); mkdirSync(sourceDirectory);
    writeFileSync(join(sourceDirectory, 'index.html'), `<html><style>html,body{margin:0;background:transparent}</style><script>window.DUR=${context.duration};${script}</script></html>`);
    return (await post('/api/codex/import-page', { sourceDirectory })).page.pageId as string;
  }
  async function save(layers: VisualPlan['layers'], assetIds: string[] = []) {
    let segment = (await queryStatus(service.url)).snapshot.segments[0]!;
    await post('/api/codex/modify', { changes: [{ kind: 'materials', expected: segment, assetIds }] });
    segment = (await queryStatus(service.url)).snapshot.segments[0]!;
    const result = await post('/api/codex/modify', { changes: [{ kind: 'composition', expected: segment, plan: { duration: context.duration, layers } }] });
    expect(result.summary.applied, JSON.stringify(result)).toBe(1);
  }
  async function task(kind: 'preview' | 'export' = 'preview', timeout = 60000) {
    const submitted = await post(kind === 'preview' ? '/api/visual-previews/submit' : '/api/exports/submit', kind === 'preview' ? { segmentId } : {});
    let task: ExportTask | undefined;
    await expect.poll(async () => {
      task = (await fetch(service.url + (kind === 'preview' ? '/api/visual-previews' : '/api/exports')).then(r => r.json())).tasks.find((t: ExportTask) => t.id === submitted.id);
      return task && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(task.state);
    }, { timeout }).toBe(true);
    return task!;
  }
  return { root, options, service, post, segmentId, duration: context.duration, styleDirectory, setStyle, importPage, save, task };
}
export const fullPage = (pageId: string, duration: number): Extract<VisualPlan['layers'][number], { kind: 'page' }> => ({ kind: 'page', pageId, assetIds: [], role: 'background', from: 0, to: duration, x: 0, y: 0, width: 1, height: 1, z: 0 });
