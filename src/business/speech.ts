import { z } from 'zod';
import type { SpeechInput, SpeechTimestamp } from '../shared/contracts.js';
import { mediaProcess } from './media-process.js';
export interface SpeechRuntime {
  key: () => string;
  configPath: string;
  fetch?: typeof fetch;
}
export class SpeechFailure extends Error {
  constructor(message: string, readonly unknownResult = false) { super(message); }
}
const unknownMessage = '结果未知，可能已计费。请核对供应商记录后决定是否发起新的生成；不会自动重试。';
const sentenceSchema = z.object({ words: z.array(z.object({
  word: z.string().refine(word => word.trim().length > 0),
  startTime: z.number().nonnegative(),
  endTime: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
})).optional() });

export async function decodedSpeechDuration(path: string, signal?: AbortSignal): Promise<number> {
  const { stdout } = await mediaProcess('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mp3,wav', '-select_streams', 'a:0', '-show_frames', '-show_entries', 'stream=sample_rate:frame=nb_samples', '-of', 'json', path], { signal });
  const decoded = JSON.parse(stdout);
  const rate = Number(decoded.streams?.[0]?.sample_rate);
  const duration = decoded.frames?.reduce((sum: number, frame: { nb_samples: number }) => sum + Number(frame.nb_samples), 0) / rate;
  if (!(duration > 0 && Number.isFinite(duration))) throw new Error('无法确认配音时长');
  return duration;
}

export async function synthesize(input: SpeechInput, key: string, requestId: string, runtime: SpeechRuntime, signal: AbortSignal): Promise<{ audio: Buffer; timestamps?: SpeechTimestamp[] }> {
  try {
    const response = await (runtime.fetch ?? fetch)('https://tokendance.space/gateway/ark/v3/tts/unidirectional', {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(300000)]),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Api-Resource-Id': 'seed-tts-2.0', 'X-Api-Request-Id': requestId },
      // TokenDance seed-tts-2.0 实测只需 audio_params.enable_subtitle。
      body: JSON.stringify({ req_params: { text: input.text, speaker: input.voice.speaker, audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: input.voice.speechRate, enable_subtitle: true } } }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403].includes(response.status)) throw new SpeechFailure('鉴权失败，请检查本机 TOKENDANCE_KEY。');
      if (response.status === 402) throw new SpeechFailure('余额不足，请补充 TokenDance 余额后发起新操作。');
      if (response.status === 429) throw new SpeechFailure('请求限流，请稍后手动发起新操作。');
      throw new SpeechFailure(`服务错误（HTTP ${response.status}），请检查 TokenDance 服务状态。${response.status >= 500 ? unknownMessage : ''}`, response.status >= 500);
    }
    if (!response.body) throw new SpeechFailure(unknownMessage, true);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const audio: Buffer[] = []; let pending = ''; let size = 0;
    let timestamps: SpeechTimestamp[] | undefined = [];
    let timestampSize = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        pending += decoder.decode(chunk.value, { stream: !chunk.done });
        if (pending.length > 16 * 1024 * 1024) throw new SpeechFailure(unknownMessage, true);
        let boundary: number;
        while ((boundary = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, boundary).trimEnd(); pending = pending.slice(boundary + 1);
          if (!line.startsWith('data:')) continue;
          const frame = JSON.parse(line.slice(5).trim());
          if (!frame || typeof frame !== 'object' || !Number.isInteger(frame.code)) throw new SpeechFailure(unknownMessage, true);
          if (frame.code === 20000000) {
            if (!size) throw new SpeechFailure('服务返回空音频，请检查服务状态后手动重试。');
            return { audio: Buffer.concat(audio), timestamps: timestamps?.length ? timestamps : undefined };
          }
          if (frame.code !== 0) throw new SpeechFailure(`服务错误（代码 ${Number(frame.code) || '未知'}），请检查 TokenDance 服务状态后手动重试。`);
          if (frame.data) {
            if (typeof frame.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(frame.data)) throw new SpeechFailure(unknownMessage, true);
            const data = Buffer.from(frame.data, 'base64'); size += data.length;
            if (size > 64 * 1024 * 1024) throw new SpeechFailure(unknownMessage, true);
            audio.push(data);
          }
          // 每个非空 words 帧提供一个子句，时间已是相对整段配音起点的秒数。
          // 空 words 帧也可能夹在子句之间，不影响已收到的时间戳。
          if (timestamps && frame.sentence != null) {
            timestampSize += line.length;
            const sentence = timestampSize <= 16 * 1024 * 1024 ? sentenceSchema.safeParse(frame.sentence) : undefined;
            const words = sentence?.success ? sentence.data.words ?? [] : undefined;
            const previousEnd = timestamps.at(-1)?.endTime ?? 0;
            if (!words || words.some((word, index) => word.endTime < word.startTime || word.startTime < (words[index - 1]?.endTime ?? previousEnd))) {
              timestamps = undefined;
            } else {
              for (const word of words) timestamps.push(word);
            }
          }
        }
        if (chunk.done) throw new SpeechFailure(unknownMessage, true);
      }
    } finally { await reader.cancel().catch(() => {}); }
  } catch (error) {
    // 不回显响应正文、网络异常或鉴权头，防止供应商错误泄露密钥。
    if (error instanceof SpeechFailure) throw error;
    throw new SpeechFailure(unknownMessage, true);
  }
}
