export const fixture = String.raw`
  export function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
  const copy = value => structuredClone(value);
  export const state = {
    status: { instanceId: 'test', pid: 1, modification: null, taskLocked: false, snapshot: {
      project: { id: 'project', directory: '/tmp/project' }, assets: [],
      segments: [{ id: 'segment', order: 1, text: '原文', video: null }],
      exportSettings: { codec: 'libx264', fps: 30, fontFamily: 'Test', fontSize: 32 },
    } }, queries: [], delayQuery: false, acquireGate: null, saveGate: null, current: null, leases: [], saves: 0, mutations: [], speech: null, exports: { locked: false, tasks: [] }, statusFailure: false, exportFailure: false, submitFailure: false, cancelFailure: false, saveFailure: false, selectionFailure: false, voiceFailure: false, batchFailure: false, exportRequests: [], exportQueries: 0,
  };
  export async function queryStatus() {
    if (state.statusFailure) throw Error('项目读取失败');
    const result = copy(state.status);
    if (state.delayQuery) { const gate = deferred(); state.queries.push({ gate, result }); await gate.promise; }
    return result;
  }
  export async function querySpeech() { return copy(state.speech) ?? { locked: false, voice: { speaker: 'zh_female_vv_uranus_bigtts', speechRate: 0 }, configured: false, configPath: '/tmp/config', operations: [], tasks: [], audio: [] }; }
  export async function queryExports() { state.exportQueries++; if (state.exportFailure) throw Error('读取导出任务失败'); return copy(state.exports); }
  export async function queryExportSettings() {
    if (state.settingsGate) await state.settingsGate.promise;
    if (state.settingsFailure) throw Error('媒体组件与字体读取失败');
    return { settings: copy(state.status.snapshot.exportSettings), fonts: state.fonts ?? ['Test'], issues: state.settingsIssues ?? [] };
  }
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
  export async function saveExportSettings(_, { expected, settings }, token) {
    (state.settingsRequests ??= []).push({ expected: copy(expected), settings: copy(settings), token });
    if (settings.fontSize !== null && (!Number.isInteger(settings.fontSize) || settings.fontSize < 1 || settings.fontSize > 1080)) throw Error('字幕字号须为 1–1080 的整数');
    if (state.saveFailure) throw Error('设置保存失败');
    state.saves++; state.status.snapshot.exportSettings = copy(settings);
    const result = { settings: copy(settings), status: copy(state.status) };
    if (state.saveGate) await state.saveGate.promise;
    return result;
  }
  export async function saveSegment(_, change, token) {
    (state.segmentRequests ??= []).push({ change: copy(change), token });
    if (state.segmentFailure) throw Error('文案保存失败');
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
  export async function connectTable() { const done = deferred(); (state.tableConnections ??= []).push(done); return { tableId: 'table', select: async ids => { (state.selectionRequests ??= []).push(copy(ids)); if (state.selectionFailure) throw Error('勾选同步失败'); }, closed: done.promise, close: async () => done.resolve() }; }
  export async function submitSpeech(_, request) { (state.speechRequests ??= []).push(copy(request)); state.mutations.push('配音'); if (state.speechGate) await state.speechGate.promise; if (state.speechFailure) throw Error('配音请求断开'); } export async function setVoice(_, voice) { if (state.voiceFailure) throw Error('声音保存失败'); state.mutations.push('声音设置'); if (state.saveGate) await state.saveGate.promise; if (state.speech) state.speech.voice = copy(voice); }
  export async function modifyUserBatch(_, batch) {
    (state.batchRequests ??= []).push(copy(batch));
    if (state.batchFailure) throw Error('多行新增失败');
    state.saves++; state.mutations.push('片段');
    for (const change of batch.changes) {
      if (change.kind === 'paste') for (const text of change.text.split('\n').filter(line => line.trim())) state.status.snapshot.segments.push({ id: 'paste-' + state.status.snapshot.segments.length, order: state.status.snapshot.segments.length + 1, text, video: null });
      if (change.kind === 'delete') state.status.snapshot.segments = state.status.snapshot.segments.filter(item => item.id !== change.expected.id);
      if (change.kind === 'reorder') state.status.snapshot.segments = change.ids.map(id => state.status.snapshot.segments.find(item => item.id === id));
      if (change.kind === 'video') {
        const segment = state.status.snapshot.segments.find(item => item.id === change.expected.id);
        segment.video = change.assetId ? { assetId: change.assetId, start: change.start } : null;
      }
    }
    state.status.snapshot.segments.forEach((segment, index) => { segment.order = index + 1; });
    const result = { status: copy(state.status), summary: { applied: batch.changes.length }, results: [] };
    if (state.saveGate) await state.saveGate.promise;
    return result;
  }
  export async function submitExport(...args) { state.exportRequests.push(args); if (state.submitFailure) throw Error('Codex 正在修改'); state.mutations.push('导出'); } export async function cancelExport() { if (state.cancelGate) await state.cancelGate.promise; if (state.cancelFailure) throw Error('取消导出失败'); state.mutations.push('取消导出'); }
`;
