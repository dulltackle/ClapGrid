import { fixture } from './editing-fixture.js';

/** 仅在 HTTP seam 控制相对新增响应、修改权与失败；保留真实页面及 AG Grid。 */
export const relativeInsertFixture = fixture
  .replace("if (state.current) throw Error('用户正在编辑');", `
    if (state.acquireFailure) throw Error(state.acquireFailure);
    if (state.status.taskLocked || state.speech?.locked || state.exports?.locked) throw Error('项目已锁定');
    if (state.current) throw Error('用户正在编辑');`)
  .replace('export async function modifyUserBatch(_, batch) {', 'export async function modifyUserBatch(_, batch, token, signal) { (state.batchSignals ??= []).push(signal);')
  .replace("if (state.batchFailure) throw Error('多行新增失败');", `
    if (state.batchGate) await state.batchGate.promise;
    for (const change of batch.changes) {
      if (change.kind !== 'add' || !change.relative) continue;
      const { anchor, expectedIds } = change.relative;
      const current = state.status.snapshot.segments.find(segment => segment.id === anchor.id);
      const outcome = !current ? 'deleted' : JSON.stringify(state.status.snapshot.segments.map(segment => segment.id)) !== JSON.stringify(expectedIds)
        || JSON.stringify(current) !== JSON.stringify(anchor) ? 'changed' : undefined;
      if (outcome) return { status: copy(state.status), summary: { applied: 0 }, results: [{ index: 0, outcome, message: '相对锚点或顺序已变化' }] };
    }
    if (state.batchFailure) throw Error('多行新增失败');`)
  .replace("for (const change of batch.changes) {\n      if (change.kind === 'add' && !change.relative)", `for (const change of batch.changes) {
      if (change.kind === 'add' && change.relative) {
        const id = 'new-' + (state.batchRequests.length - 1);
        const list = state.status.snapshot.segments;
        list.splice(list.findIndex(segment => segment.id === change.relative.anchor.id) + (change.relative.placement === 'after' ? 1 : 0), 0,
          { id, order: 0, text: change.text, visualNote: '', video: null });
      }
      if (change.kind === 'add' && !change.relative)`)
  .replace('results: [] };', "results: [{ index: 0, id: 'new-' + (state.batchRequests.length - 1), outcome: 'applied', message: '已完成' }] };");
