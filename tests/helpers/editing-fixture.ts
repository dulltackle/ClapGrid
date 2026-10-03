export const fixture = String.raw`
  export function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
  const copy = value => structuredClone(value);
  export const state = {
    status: { instanceId: 'test', pid: 1, modification: null, taskLocked: false, snapshot: {
      project: { id: 'project', directory: '/tmp/project' }, assets: [],
      segments: [{ id: 'segment', order: 1, text: '原文', video: null }],
      exportSettings: { codec: 'libx264', fps: 30, fontFamily: 'Test', fontSize: 32 },
    } }, queries: [], delayQuery: false, acquireGate: null, saveGate: null, current: null, leases: [], saves: 0, mutations: [], speech: null,
  };
  export async function queryStatus() {
    const result = copy(state.status);
    if (state.delayQuery) { const gate = deferred(); state.queries.push({ gate, result }); await gate.promise; }
    return result;
  }
  export async function querySpeech() { return copy(state.speech) ?? { locked: false, voice: { speaker: 'zh_female_vv_uranus_bigtts', speechRate: 0 }, configured: false, configPath: '/tmp/config', operations: [], tasks: [], audio: [] }; }
  export async function queryExports() { return { locked: false, tasks: [] }; }
  export async function queryExportSettings() { return { settings: copy(state.status.snapshot.exportSettings), fonts: ['Test'], issues: [] }; }
  export async function beginEdit() {
    if (state.current) throw Error('用户正在编辑');
    const ended = deferred();
    const lease = { token: 'lease-' + state.leases.length, closed: ended.promise, closes: 0,
      disconnect() { if (state.current === lease) { state.current = null; state.status.modification = null; } ended.resolve(); },
      async close() { lease.closes++; lease.disconnect(); },
    };
    state.current = lease; state.leases.push(lease); state.status.modification = { owner: 'user' }; lease.status = copy(state.status);
    if (state.acquireGate) await state.acquireGate.promise;
    return lease;
  }
  export async function saveExportSettings(_, { settings }) {
    state.saves++; state.status.snapshot.exportSettings = copy(settings);
    const result = { settings: copy(settings), status: copy(state.status) };
    if (state.saveGate) await state.saveGate.promise;
    return result;
  }
  export async function saveSegment(_, change) {
    state.saves++;
    if (change.id) state.status.snapshot.segments[0].text = change.text;
    state.current.disconnect();
    const result = copy(state.status);
    if (state.saveGate) await state.saveGate.promise;
    return result;
  }
  export async function importVideo() {
    state.saves++; const result = { status: copy(state.status) };
    if (state.saveGate) await state.saveGate.promise;
    return result;
  }
  export async function connectTable() { const done = deferred(); return { tableId: 'table', select: async () => {}, closed: done.promise, close: async () => done.resolve() }; }
  export async function submitSpeech() { state.mutations.push('配音'); } export async function setVoice() { state.mutations.push('声音设置'); }
  export async function modifyUserBatch(_, batch) {
    state.saves++; state.mutations.push('片段');
    for (const change of batch.changes) {
      if (change.kind === 'video') {
        const segment = state.status.snapshot.segments.find(item => item.id === change.expected.id);
        segment.video = change.assetId ? { assetId: change.assetId, start: change.start } : null;
      }
    }
    const result = { status: copy(state.status), summary: { applied: batch.changes.length }, results: [] };
    if (state.saveGate) await state.saveGate.promise;
    return result;
  }
  export async function submitExport() { state.mutations.push('导出'); } export async function cancelExport() { state.mutations.push('取消导出'); }
`;

