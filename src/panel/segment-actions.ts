import { segmentMaterials } from '../shared/contracts.js';
import type { Segment, SpeechStatus } from '../shared/contracts.js';
import { segmentTargets } from './segment-targets.js';
import { segmentSpeech } from './speech-state.js';

type Area = 'script' | 'note' | 'visual' | 'speech' | 'row' | 'footer';
export type SegmentAction = { area: Area; ids: string[]; enabled: boolean; reason: string };
/** 所有入口共享动作归属、稳定身份范围及不可用原因；服务仍负责最终冲突检查。 */
export function segmentActions({ segment, segments, checkedIds = [], speech, reason = '', draftText }: {
  segment: Segment; segments: Segment[]; checkedIds?: string[]; speech?: SpeechStatus; reason?: string; draftText?: string;
}) {
  const targets = segmentTargets(segments, checkedIds, segment.id).map(item => item.id);
  const state = segmentSpeech(segment.id, speech);
  const pending = state.latest?.state === 'accepted' || state.latest?.state === 'running';
  const action = (area: Area, cause = '', ids = [segment.id]): SegmentAction => ({ area, ids, enabled: !cause, reason: cause });
  const mutable = (area: Area, cause = '', ids?: string[]) => action(area, reason || cause, ids);
  const insertReason = targets.length !== 1 ? '仅能在单个口播片段上方或下方添加' : '';
  return {
    ...state, primaryLabel: pending ? state.state : state.audio ? '试听' : state.latest?.state === 'failed' || state.latest?.state === 'unknown' ? '重试' : '生成配音',
    editText: mutable('script'), editNote: mutable('note'), associate: mutable('visual'), changeVisual: mutable('visual'),
    unlink: mutable('visual', segmentMaterials(segment).length ? '' : '尚未关联画面'), preview: action('visual', segmentMaterials(segment).length ? '' : '尚未关联画面'),
    generate: mutable('speech', pending ? '配音任务进行中，请等待完成' : !(draftText ?? segment.text).trim() ? '请先填写文案' : ''),
    listen: action('speech', state.audio ? '' : '尚无可试听的配音'), history: action('speech'),
    delete: mutable('row', targets.length ? '' : '没有可操作的口播片段', targets),
    insertBefore: mutable('row', insertReason, targets), insertAfter: mutable('row', insertReason, targets),
    deleteChecked: mutable('footer', checkedIds.length ? '' : '请先勾选口播片段', segments.filter(item => checkedIds.includes(item.id)).map(item => item.id)),
    drag: mutable('row', '', targets),
  };
}
export type SegmentActions = ReturnType<typeof segmentActions>;

export function segmentRowMenu(actions: SegmentActions, order: number) {
  const count = actions.delete.ids.length;
  return {
    scope: count === 1 ? `片段 ${order}` : `已勾选 ${count} 条`,
    items: [
      { key: 'delete' as const, label: count === 1 ? '删除本片段' : `删除已勾选的 ${count} 条`, ...actions.delete },
      { key: 'before' as const, label: '上方添加', ...actions.insertBefore },
      { key: 'after' as const, label: '下方添加', ...actions.insertAfter },
    ],
  };
}
