import type { Segment } from '../shared/contracts.js';

/** 右键与拖动共用固定身份范围，按项目顺序保留勾选集合的内部顺序。 */
export function segmentTargets(segments: Segment[], checkedIds: string[], id: string) {
  const ids = new Set(checkedIds.includes(id) ? checkedIds : [id]);
  return segments.filter(segment => ids.has(segment.id));
}

