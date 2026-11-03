import { describe, expect, test } from 'vitest';
import { segmentActions } from '../src/panel/segment-actions.js';
import type { Segment } from '../src/shared/contracts.js';
const segments: Segment[] = ['a', 'b', 'c'].map((id, index) => ({ id, order: index + 1, text: id, visualNote: '', video: null }));
describe('口播片段操作呈现', () => {
  test('本行已勾选时删除固定勾选集合，相对插入解释单片段限制', () => {
    const actions = segmentActions({ segment: segments[0]!, segments, checkedIds: ['a', 'c'] });
    expect(actions.delete).toMatchObject({ area: 'row', ids: ['a', 'c'], enabled: true });
    expect(actions.insertBefore).toMatchObject({ area: 'row', enabled: false, reason: '仅能在单个口播片段上方或下方添加' });
    expect(actions.associate).toMatchObject({ area: 'visual', ids: ['a'], enabled: true });
  });
});

test('项目占用对行内、本行菜单和页脚给出同一禁用原因，试听与历史仍可用', () => {
  const actions = segmentActions({ segment: segments[1]!, segments, checkedIds: ['a'], reason: 'Codex 正在修改' });
  for (const key of ['editText', 'editNote', 'associate', 'generate', 'delete', 'insertBefore', 'deleteChecked', 'drag'] as const) {
    expect(actions[key]).toMatchObject({ enabled: false, reason: 'Codex 正在修改' });
  }
  expect(actions.delete.ids).toEqual(['b']);
  expect(actions.deleteChecked.ids).toEqual(['a']);
  expect(actions.history.enabled).toBe(true);
});

import type { SpeechStatus } from '../src/shared/contracts.js';
for (const [state, label] of [['accepted', '排队中'], ['running', '生成中'], ['failed', '重试'], ['unknown', '重试']] as const) test(`${state} 配音主动作及任务禁用原因`, () => {
  const speech = { tasks: [{ segmentId: 'a', state }], audio: [] } as unknown as SpeechStatus;
  const actions = segmentActions({ segment: segments[0]!, segments, speech });
  expect(actions.primaryLabel).toBe(label);
  expect(actions.generate.enabled).toBe(!['accepted', 'running'].includes(state));
  if (state === 'accepted' || state === 'running') expect(actions.generate.reason).toBe('配音任务进行中，请等待完成');
});
for (const valid of [false, true]) test(`已有${valid ? '有效' : '待更新'}配音优先试听且允许更新`, () => {
  const speech = { tasks: [], audio: [{ segmentId: 'a', taskId: 'audio', valid }] } as unknown as SpeechStatus;
  const actions = segmentActions({ segment: segments[0]!, segments, speech });
  expect(actions.primaryLabel).toBe('试听'); expect(actions.listen.enabled).toBe(true); expect(actions.generate.enabled).toBe(true);
  expect(actions.state).toBe(valid ? '有效配音' : '配音待更新');
});

test('空文案与空勾选解释不可用动作，已有文案草稿可生成', () => {
  const segment = { ...segments[0]!, text: '' };
  expect(segmentActions({ segment, segments }).generate).toMatchObject({ enabled: false, reason: '请先填写文案' });
  expect(segmentActions({ segment, segments, draftText: '新文案' }).generate.enabled).toBe(true);
  expect(segmentActions({ segment, segments }).deleteChecked).toMatchObject({ enabled: false, reason: '请先勾选口播片段' });
});
