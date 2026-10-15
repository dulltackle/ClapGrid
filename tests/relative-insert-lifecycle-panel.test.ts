import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome } from './helpers/browser.js';
import { checkInteractiveBrowser } from './helpers/interactive-browser.js';
import { relativeInsertFixture } from './helpers/relative-insert-fixture.js';

const failure = (mode: 'active' | 'late' | 'deleted' | 'changed' | 'frame') => String.raw`
import { act } from 'react'; import { createRoot } from 'react-dom/client'; import { App } from './src/panel/app.tsx'; import { state, deferred } from 'editing-fixture';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const timers = new Map(); let timer = 0; window.setInterval = callback => { timers.set(++timer, callback); return timer; }; window.clearInterval = id => timers.delete(id);
const settle = () => new Promise(resolve => setTimeout(resolve, 80));
const check = (value, message) => { if (!value) throw Error(message); };
const action = async callback => { await act(async () => { await callback(); await settle(); }); await settle(); };
const button = text => [...document.querySelectorAll('button')].find(node => node.textContent === text);
const input = request => action(() => window.browserInput(request));
(async () => { try {
  state.status.snapshot.segments = ['a','b','c','d'].map((id, index) => ({ id, order: index + 1, text: id, visualNote: '', video: null }));
  await action(() => createRoot(document.getElementById('root')).render(<App />));
  await input({ click: '[row-id="b"] [col-id="text"]', button: 'right' });
  state.batchGate = deferred(); state.batchFailure = true; const gate = state.batchGate;
  await input({ click: '[role="menuitem"]:nth-child(2)' });
  check(state.batchRequests.length === 1 && !document.activeElement.closest('[row-id]'), '添加交接不产生菜单到表格的中间恢复');
  if ('${mode}' === 'deleted') state.status.snapshot.segments = state.status.snapshot.segments.filter(segment => segment.id !== 'b');
  if ('${mode}' === 'changed') state.status.snapshot.segments[1].text = '外部修改';
  const originalFrame = window.requestAnimationFrame, originalCancel = window.cancelAnimationFrame;
  const frames = new Map(); let frameId = 0;
  if ('${mode}' === 'frame') {
    window.requestAnimationFrame = callback => { const id = --frameId; frames.set(id, callback); return id; };
    window.cancelAnimationFrame = id => { if (id < 0) frames.delete(id); else originalCancel(id); };
  }
  if ('${mode}' === 'late') { await action(() => button('查找').click()); await input({ key: 'b' }); }
  await action(() => { state.batchGate = null; gate.resolve(); });
  if ('${mode}' === 'frame') { await action(() => button('查找').click()); await input({ key: 'b' }); }
  const active = document.activeElement;
  const scroll = document.querySelector('.ag-body-vertical-scroll-viewport').scrollTop;
  if ('${mode}' === 'frame') {
    window.requestAnimationFrame = originalFrame; window.cancelAnimationFrame = originalCancel;
    await action(() => { for (const callback of frames.values()) callback(performance.now()); });
  }
  check(document.querySelector('[data-save-status]').textContent === '保存失败' && document.querySelector('[aria-label="操作异常"]').textContent.includes('${mode}' === 'deleted' || '${mode}' === 'changed' ? '相对锚点或顺序已变化' : '多行新增失败'), '失败按原规则公开反馈');
  check(state.batchRequests.length === 1 && !state.status.snapshot.segments.some(segment => segment.id.startsWith('new-')) && !document.querySelector('[aria-label="文案全文"]'), '失败不重试、不创建虚假片段或开启编辑');
  const request = state.batchRequests[0].changes[0].relative;
  check(request.anchor.id === 'b' && request.anchor.text === 'b' && request.expectedIds.join() === 'a,b,c,d' && request.placement === 'before', '保持菜单打开时完整锚点、顺序与相对方向快照');
  if ('${mode}' === 'late' || '${mode}' === 'frame') {
    check(document.activeElement === active && active.getAttribute('aria-label') === '查找文案' && active.value === 'b' && document.querySelector('.ag-body-vertical-scroll-viewport').scrollTop === scroll, '迟到失败或失败返回帧不抢查找焦点及滚动');
  } else {
    const expected = '${mode}' === 'deleted' ? 'c' : 'b';
    check(document.activeElement.closest('[row-id]')?.getAttribute('row-id') === expected && document.activeElement.getAttribute('col-id') === 'text', '合法失败按捕获来源或当前显示位置返回原列');
    await input({ key: 'ArrowDown' });
    check(document.activeElement.closest('[row-id]')?.getAttribute('row-id') === ('${mode}' === 'deleted' ? 'd' : 'c'), '失败返回后可继续真实方向键导航');
  }
  check(!state.current && state.leases[0].closes === 1, '失败释放原租约一次');
  document.getElementById('result').dataset.state = 'passed';
} catch(error) { document.getElementById('result').dataset.state = 'failed'; document.getElementById('result').textContent = error.stack; } })();
`;
for (const mode of ['active', 'late', 'deleted', 'changed', 'frame'] as const) test('相对添加失败与来源恢复：' + mode, { timeout: 40000 }, t => {
  assert.ok(chrome, '必须实际运行 Chrome');
  return checkInteractiveBrowser(t, failure(mode), relativeInsertFixture, 1600, 1000);
});

const oldResponse = String.raw`
import { act } from 'react'; import { createRoot } from 'react-dom/client'; import { App } from './src/panel/app.tsx'; import { state, deferred } from 'editing-fixture';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const timers = new Map(); let timer = 0; window.setInterval = callback => { timers.set(++timer, callback); return timer; }; window.clearInterval = id => timers.delete(id);
const settle = () => new Promise(resolve => setTimeout(resolve, 80)); const check = (value, message) => { if (!value) throw Error(message); };
const action = async callback => { await act(async () => { await callback(); await settle(); }); await settle(); };
const input = request => action(() => window.browserInput(request));
(async () => { try {
  state.status.snapshot.segments = ['a','b','c'].map((id, index) => ({ id, order: index + 1, text: id, visualNote: '', video: null }));
  await action(() => createRoot(document.getElementById('root')).render(<App />));
  await input({ click: '[row-id="b"] [col-id="text"]', button: 'right' });
  state.saveGate = deferred(); const gate = state.saveGate;
  await input({ click: '[role="menuitem"]:nth-child(3)' });
  const oldLease = state.leases[0];
  await action(() => window.dispatchEvent(new Event('pagehide')));
  check(state.batchSignals[0].aborted && oldLease.closes === 1, '离页使原请求失效并释放原租约');
  await action(() => window.dispatchEvent(new Event('pageshow')));
  check(document.querySelector('[row-id="new-0"]'), '重新读取仍接收服务端已经合法完成的新增');
  await new Promise(resolve => setTimeout(resolve, 350));
  await input({ click: '[row-id="c"] [col-id="text"]' });
  const editor = document.querySelector('[aria-label="文案全文"]');
  check(editor?.closest('[row-id]')?.getAttribute('row-id') === 'c', '重新进入另一片段的真实编辑器：' + JSON.stringify({active:document.activeElement.outerHTML.slice(0,300),editor:editor?.outerHTML.slice(0,200),leases:state.leases.length,current:state.current?.token,errors:document.querySelector('[aria-label="操作异常"]')?.textContent}));
  await input({ key: 'Y' }); const newLease = state.current;
  await action(() => { state.saveGate = null; gate.resolve(); });
  check(document.activeElement === editor && editor.value === 'Y' && editor.closest('[row-id]').getAttribute('row-id') === 'c', '旧新增响应不覆盖新编辑焦点、片段或草稿');
  check(state.current === newLease && newLease.closes === 0 && oldLease.closes === 1 && state.batchRequests.length === 1, '旧响应不释放新租约、不重复新增或重启编辑');
  await input({ key: 'Escape' });
  document.getElementById('result').dataset.state = 'passed';
} catch(error) { document.getElementById('result').dataset.state = 'failed'; document.getElementById('result').textContent = error.stack; } })();
`;
test('相对添加离页后旧响应失效且不影响新编辑和租约', { timeout: 40000 }, t => {
  assert.ok(chrome, '必须实际运行 Chrome');
  return checkInteractiveBrowser(t, oldResponse, relativeInsertFixture, 1600, 1000);
});

const locked = (kind: 'task' | 'speech' | 'export' | 'owner') => String.raw`
import { act } from 'react'; import { createRoot } from 'react-dom/client'; import { App } from './src/panel/app.tsx'; import { state } from 'editing-fixture';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const timers = new Map(); let timer = 0; window.setInterval = callback => { timers.set(++timer, callback); return timer; }; window.clearInterval = id => timers.delete(id);
const settle = () => new Promise(resolve => setTimeout(resolve, 80)); const check = (value, message) => { if (!value) throw Error(message); };
const action = async callback => { await act(async () => { await callback(); await settle(); }); await settle(); };
const input = request => action(() => window.browserInput(request));
(async () => { try {
  state.status.snapshot.segments = ['a','b','c'].map((id, index) => ({ id, order: index + 1, text: id, visualNote: '', video: null }));
  await action(() => createRoot(document.getElementById('root')).render(<App />));
  await input({ click: '[row-id="b"] [col-id="text"]', button: 'right' });
  // 菜单展示后服务端才出现锁，尚未轮询；必须由真实修改权请求拒绝。
  if ('${kind}' === 'task') state.status.taskLocked = true;
  if ('${kind}' === 'speech') state.speech = { locked: true, voice: { speaker: 'test', speechRate: 0 }, configured: false, operations: [], tasks: [], audio: [] };
  if ('${kind}' === 'export') state.exports.locked = true;
  if ('${kind}' === 'owner') state.acquireFailure = 'Codex 正在修改';
  await input({ click: '[role="menuitem"]:nth-child(2)' });
  check(!state.batchRequests?.length && !state.leases.length && state.status.snapshot.segments.map(segment => segment.id).join() === 'a,b,c', '新锁或外部占用不绕过修改权、不发送新增请求');
  check(document.querySelector('[data-save-status]').textContent === '保存失败' && !document.querySelector('[aria-label="文案全文"]'), '服务拒绝按既有失败语义反馈且不进入编辑');
  check(document.activeElement.closest('[row-id]')?.getAttribute('row-id') === 'b', '有效失败仍返回菜单原来源');
  document.getElementById('result').dataset.state = 'passed';
} catch(error) { document.getElementById('result').dataset.state = 'failed'; document.getElementById('result').textContent = error.stack; } })();
`;
for (const kind of ['task', 'speech', 'export', 'owner'] as const) test('相对添加保留服务修改权与锁规则：' + kind, { timeout: 40000 }, t => {
  assert.ok(chrome, '必须实际运行 Chrome');
  return checkInteractiveBrowser(t, locked(kind), relativeInsertFixture, 1600, 1000);
});
