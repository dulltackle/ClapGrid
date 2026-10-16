import { test } from 'node:test';
import { fixture } from './helpers/editing-fixture.js';
import { checkInteractiveBrowser } from './helpers/interactive-browser.js';

const script = String.raw`
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './src/panel/app.tsx';
import { state } from 'editing-fixture';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const intervals = new Map(); let timer = 0;
window.setInterval = fn => { intervals.set(++timer, fn); return timer; }; window.clearInterval = id => intervals.delete(id);
const settle = () => new Promise(resolve => setTimeout(resolve, 100));
const action = async fn => { await act(async () => { await fn(); await settle(); }); await settle(); };
const check = (value, message) => { if (!value) throw Error(message); };
const click = selector => action(() => window.browserInput({ click: selector }));
const key = key => action(() => window.browserInput({ key }));
const input = (selector, value) => action(() => {
  const node = document.querySelector(selector); check(node, '编辑器存在');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(node, value);
  node.dispatchEvent(new Event('input', { bubbles: true }));
});
const button = name => [...document.querySelectorAll('button')].find(node => node.textContent === name);
(async () => { try {
  await action(() => createRoot(document.getElementById('root')).render(<App />));
  check(!document.querySelector('[col-id="visualNote"]'), '说明合并到文案摘要');
  await click('[row-id="segment"] [data-note-toggle]');
  check(document.querySelector('[role="region"]').textContent.includes('暂无画面说明'), '空说明可展开');
  await click('[aria-label="查看片段 1 的详情"]');
  const detail = '[aria-label="详情画面说明"]';
  check(document.querySelector(detail).value === '', '详情显示同一说明');
  await click(detail); await input(detail, '详情草稿');
  await action(() => { button('关闭详情').click(); });
  check(document.querySelector('[role="alertdialog"]'), '关闭前保护说明草稿');
  await click('[data-continue-editing]');
  check(document.activeElement === document.querySelector(detail), '继续编辑回到说明');
  await action(() => { state.segmentFailure = true; button('保存画面说明').click(); });
  check(document.querySelector(detail).value === '详情草稿', '保存失败保留草稿');
  await action(() => { state.segmentFailure = false; button('保存画面说明').click(); });
  check(state.status.snapshot.segments[0].visualNote === '详情草稿', '重存成功');
  await click(detail); await input(detail, '断线草稿');
  await action(() => state.current.disconnect());
  state.status.snapshot.segments[0].visualNote = '外部新说明';
  await action(() => button('保存画面说明').click());
  check(state.status.snapshot.segments[0].visualNote === '外部新说明' && document.querySelector(detail).value === '断线草稿' && document.body.textContent.includes('不能覆盖新内容'), '断线重存拒绝覆盖新说明');
  await action(() => button('关闭详情').click()); await click('[data-discard-draft]');
  await click('[aria-label="查看片段 1 的详情"]');
  await click(detail); await input(detail, '');
  await action(() => button('保存画面说明').click());
  check(state.status.snapshot.segments[0].visualNote === '' && state.status.snapshot.segments[0].text === '原文', '说明允许清空且保留文案');
  await action(() => { button('关闭详情').click(); });
  await action(() => { state.status.taskLocked = true; [...intervals.values()].forEach(fn => fn()); });
  await click('[aria-label="查看片段 1 的详情"]');
  check(document.querySelector(detail).disabled, '任务锁阻止详情说明编辑');
  document.getElementById('result').dataset.state = 'passed';
} catch (error) { document.getElementById('result').dataset.state = 'failed'; document.getElementById('result').textContent = error.stack; } })();
`;

for (const [width, height] of [[1200, 800], [420, 800]]) {
  test(`画面说明展开与详情编辑、草稿冲突及任务锁（${width}）`, { timeout: 40000 }, t => checkInteractiveBrowser(t, script, fixture, width, height));
}
