import { z } from 'zod';
import type { SpeechTimestamp } from '../shared/contracts.js';

export const pageCueLimits = { count: 256, wordLength: 4096 };
const pageCues = z.array(z.object({
  t: z.number().nonnegative(),
  word: z.string().max(pageCueLimits.wordLength).refine(word => word.trim().length > 0),
})).max(pageCueLimits.count);

export function checkPageCues(raw: unknown, layer: { from: number; to: number }, speech: {
  text: string; timestamps?: SpeechTimestamp[]; speechIssue?: string;
}) {
  const notChecked = (reason: string) => ({ status: 'not-checked' as const, reason });
  if (raw === undefined) return notChecked('页面没有提供 CUES');
  const parsed = pageCues.safeParse(raw);
  if (!parsed.success || parsed.data.some(cue => cue.t >= layer.to - layer.from)) {
    return notChecked('CUES 必须是有效的 {t, word} 数组，t 须在图层局部区间 [0, DUR) 内，word 须为非空文字');
  }
  if (!parsed.data.length) return notChecked('CUES 没有声明关键动作');
  if (!speech.timestamps?.length) return notChecked(speech.speechIssue ?? '当前配音无字级时间戳');

  const timedText = speech.timestamps.map(entry => entry.word).join('');
  const timedTrimmedStart = timedText.trimStart();
  const scriptTrimmedStart = speech.text.trimStart();
  const matchingText = timedTrimmedStart.trimEnd() === scriptTrimmedStart.trimEnd();
  const offsetShift = (timedText.length - timedTrimmedStart.length) - (speech.text.length - scriptTrimmedStart.length);
  const starts = new Map<number, number>();
  let offset = 0;
  for (const entry of speech.timestamps) {
    starts.set(offset, entry.startTime);
    offset += entry.word.length;
  }
  return { status: 'checked' as const, cues: parsed.data.map(cue => {
    const segmentTime = layer.from + cue.t;
    const notAligned = (reason: string) => ({ ...cue, segmentTime, status: 'not-aligned' as const, reason });
    const first = speech.text.indexOf(cue.word);
    if (first < 0) return notAligned('片段文案中找不到该文字');
    if (speech.text.indexOf(cue.word, first + 1) >= 0) return notAligned('该文字在片段文案中出现多次');
    const timedOffset = first + offsetShift;
    if (!matchingText || timedOffset < 0 || !timedText.startsWith(cue.word, timedOffset)) {
      return notAligned('供应商时间戳的文字与片段文案不一致');
    }
    const speechTime = starts.get(timedOffset);
    if (speechTime === undefined) return notAligned('该文字没有独立的起始时间戳');
    const delta = segmentTime - speechTime;
    // 容许计算误差，使恰好 0.2 秒的提前或滞后不触发警告。
    const roundingError = Number.EPSILON * Math.max(1, segmentTime, speechTime);
    const status = Math.abs(delta) - 0.2 > roundingError ? 'warning' as const : 'aligned' as const;
    return { ...cue, segmentTime, speechTime, delta, status };
  }) };
}

export type PixelBox = { x: number; y: number; width: number; height: number };
const coordinate = z.number().min(-1e7).max(1e7);
export const pageTexts = z.array(z.object({
  text: z.string().min(1).max(4096),
  id: z.string().min(1).max(256).optional(),
  x: coordinate, y: coordinate,
  width: coordinate.positive(), height: coordinate.positive(),
})).max(256);
type Text = z.infer<typeof pageTexts>[number];
type Issue = { kind: 'reading-time' | 'out-of-frame' | 'subtitle-overlap'; text: string; from: number; to: number; box?: PixelBox; requiredSeconds?: number };

// opuscar 默认阅读速度，尚待用 ClapGrid 样片校准。
const reading = { hanPerSecond: 4.5, otherPerSecond: 15, baseSeconds: 1.5 };
function requiredSeconds(text: string) {
  const han = [...text.matchAll(/\p{Script=Han}/gu)].length;
  return han / reading.hanPerSecond + ([...text].length - han) / reading.otherPerSecond + reading.baseSeconds;
}
function intersects(a: PixelBox, b: PixelBox) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function trackPageTexts(input: { fps: number; duration: number; x: number; y: number; scaleX: number; scaleY: number; subtitle?: PixelBox }) {
  const issues: Issue[] = [];
  let omittedIssues = 0;
  let active = new Map<string, Issue>();
  const lastFrame = Math.round(input.duration * input.fps);
  const time = (frame: number) => frame === lastFrame ? input.duration : frame / input.fps;
  const finish = (issue: Issue) => {
    if (issue.requiredSeconds !== undefined && issue.to - issue.from + 1e-9 >= issue.requiredSeconds) return;
    if (issues.length < 1000) issues.push(issue);
    else omittedIssues++;
  };
  return {
    frame(frame: number, texts: Text[]) {
      const next = new Map<string, Issue>();
      const counts = new Map<string, number>();
      for (const entry of texts) {
        const { text, id, width, height } = entry;
        const name = JSON.stringify([id, text]);
        const occurrence = counts.get(name) ?? 0;
        counts.set(name, occurrence + 1);
        const box = { x: input.x + entry.x * input.scaleX, y: input.y + entry.y * input.scaleY, width: width * input.scaleX, height: height * input.scaleY };
        const add = (kind: Issue['kind'], details: Partial<Issue>) => {
          const key = JSON.stringify([kind, name, occurrence]);
          const issue = active.get(key) ?? { kind, text, from: time(frame), to: time(frame), ...details };
          issue.to = time(frame + 1);
          next.set(key, issue);
        };
        const previous = active.get(JSON.stringify(['reading-time', name, occurrence]));
        add('reading-time', { requiredSeconds: previous?.requiredSeconds ?? requiredSeconds(text) });
        if (box.x < 0 || box.y < 0 || box.x + box.width > 1920 || box.y + box.height > 1080) add('out-of-frame', { box });
        if (input.subtitle && intersects(box, input.subtitle)) add('subtitle-overlap', { box });
      }
      for (const [key, issue] of active) if (!next.has(key)) finish(issue);
      active = next;
    },
    result() {
      for (const issue of active.values()) finish(issue);
      return { status: issues.length ? 'warnings' : 'passed', issues, omittedIssues };
    },
  };
}
