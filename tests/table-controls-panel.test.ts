import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome } from './helpers/browser.js';
import { fixture } from './helpers/editing-fixture.js';
import { checkInteractiveBrowser } from './helpers/interactive-browser.js';

const script = String.raw`
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './src/panel/app.tsx';
import { state } from 'editing-fixture';
import { assertTheme, assertKeyboardFocus } from './tests/helpers/theme-contract.ts';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const intervals = new Map(); let timer = 0;
window.setInterval = fn => { intervals.set(++timer, fn); return timer; }; window.clearInterval = id => intervals.delete(id);
const check = (ok, message) => { if (!ok) throw Error(message); };
const action = async fn => { await act(async () => { await fn(); await new Promise(r => setTimeout(r, 220)); }); };
(async () => { try {
  state.status.snapshot.segments = Array.from({length: 80}, (_, i) => ({id: String(i + 1), order: i + 1, text: '口播片段 ' + (i + 1), video: null}));
  await action(() => createRoot(document.getElementById('root')).render(<App/>));
  const row = () => document.querySelector('[row-id="1"]');
  check(row().getBoundingClientRect().height === 80, '保持 80px 行高');
  check(document.querySelectorAll('.ag-row[row-id]').length < 80, '使用真实虚拟行');
  const horizontal = document.querySelector('.ag-body-horizontal-scroll-viewport');
  const detail = () => document.querySelector('[aria-label="查看片段 1 的详情"]');
  check(document.querySelectorAll('[role="columnheader"]').length === 6, '仅五个业务表头和勾选列，没有详情列');
  check(!document.querySelector('[col-id="details"]'), '详情入口不占用单元格或列宽');
  const initialDetail = detail().getBoundingClientRect().toJSON();
  check(initialDetail.left >= 0 && initialDetail.right <= innerWidth, '横向滚动前详情入口完整可见');
  for (const scrollLeft of [200, horizontal.scrollWidth, 0]) {
    await action(() => { horizontal.scrollLeft = scrollLeft; });
    const rect = detail().getBoundingClientRect();
    check(rect.x === initialDetail.x && rect.width === initialDetail.width, '横向滚动时详情入口固定在右侧');
    check(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('button') === detail(), '固定入口可点击且未被滚动内容覆盖');
  }
  await action(() => { horizontal.scrollLeft = 500; });
  check(detail().getBoundingClientRect().height >= 24 && detail().getBoundingClientRect().width >= 24, '普通行操作具有至少 24px 点击范围');
  check(getComputedStyle(detail()).color === 'rgb(26, 28, 31)', '详情图标前景可见');
  await action(() => window.browserInput({key: 'Tab'}));
  await action(() => detail().focus());
  assertKeyboardFocus(detail());
  const generate = () => [...row().querySelectorAll('button')].find(node => node.getAttribute('aria-label') === '生成配音');
  check(generate().getBoundingClientRect().height >= 24, '配音操作保持紧凑');
  check(getComputedStyle(generate()).color === 'rgb(26, 28, 31)', '生成图标前景可见');
  state.speech = { locked: true, configured: true, configPath: '/tmp/config', voice: { speaker: 'voice', speechRate: 0 }, operations: [], audio: [], tasks: [] };
  await action(() => [...intervals.values()].forEach(fn => fn()));
  // act 提交禁用状态后，等待保留按钮实例的主题过渡完成。
  await new Promise(r => setTimeout(r, 220));
  check(generate().disabled, '任务锁禁用配音'); assertTheme('disabled', generate());
  const rect = detail().getBoundingClientRect();
  await action(async () => {
    await window.browserInput({pointer: {type: 'mousePressed', x: rect.x + rect.width / 2, y: rect.y + rect.height / 2}});
    await window.browserInput({pointer: {type: 'mouseReleased', x: rect.x + rect.width / 2, y: rect.y + rect.height / 2}});
  });
  check(document.querySelector('[aria-label="口播片段详情"]')?.textContent.includes('片段 1'), '固定入口通过真实点击打开对应片段详情');
  await action(() => window.browserInput({click: '[aria-label="口播片段详情"] button:not([aria-label])'}));
  check(document.activeElement === detail(), '关闭详情后焦点返回行悬浮按钮');
  await action(() => window.browserInput({key: 'Enter'}));
  check(document.querySelector('[aria-label="口播片段详情"]')?.textContent.includes('片段 1'), '悬浮入口支持键盘打开详情');
  await action(() => window.browserInput({click: '[aria-label="口播片段详情"] button:not([aria-label])'}));
  const viewport = document.querySelector('.ag-grid-viewport');
  await action(() => { viewport.scrollTop = viewport.scrollHeight; });
  const lastDetail = document.querySelector('[aria-label="查看片段 80 的详情"]');
  check(lastDetail && !detail(), '纵向虚拟滚动更新入口身份并卸载离开的行');
  const lastRect = lastDetail.getBoundingClientRect();
  check(lastRect.left >= 0 && lastRect.right <= innerWidth && lastRect.top >= 0 && lastRect.bottom <= innerHeight, '末行悬浮入口仍在视口内');
  await window.browserInput({screenshot: 'table-controls-HEIGHT'});
  document.getElementById('result').dataset.state = 'passed';
} catch (error) { document.getElementById('result').dataset.state = 'failed'; document.getElementById('result').textContent = error.stack; } })();
`;
for (const [width, height] of [[1600, 1000], [420, 800], [420, 360]]) {
  test(`表格紧凑操作主题与虚拟行（${width}×${height}）`, {timeout: 30000}, t => {
    assert.ok(chrome, '需要 Chrome/Chromium，不能跳过表格主题验收');
    return checkInteractiveBrowser(t, script.replace('HEIGHT', String(height)), fixture, width, height);
  });
}
