import { pageFrameLimit, type PageFrames } from '../shared/contracts.js';

export function samplingTimes(sampling: PageFrames['sampling'], duration: number, range: string) {
  if ('times' in sampling) {
    if (sampling.times.some(time => time >= duration)) throw new Error(`抽帧时间须位于${range}`);
    return sampling.times;
  }
  const { from, to, interval } = sampling;
  if (from > to || to >= duration) throw new Error(`抽帧区间须位于${range}，且起点不大于终点`);
  const count = Math.floor((to - from) / interval + 1e-9) + 1;
  if (count > pageFrameLimit) throw new Error(`每次最多抽取 ${pageFrameLimit} 帧`);
  return Array.from({ length: count }, (_, i) => Math.min(to, Number((from + i * interval).toPrecision(15))));
}
