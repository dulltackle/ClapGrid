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
  await action(() => { horizontal.scrollLeft = 500; });
  const detail = () => document.querySelector('[aria-label="查看片段 1 的画面素材详情"]');
  check(detail().getBoundingClientRect().height === 24, '普通行操作使用紧凑 24px 高度');
  assertTheme('form', detail());
  await action(() => window.browserInput({key: 'Tab'}));
  await action(() => detail().focus());
  assertKeyboardFocus(detail());
  const generate = () => [...row().querySelectorAll('button')].find(node => node.textContent === '生成配音');
  check(generate().getBoundingClientRect().height === 24, '配音操作保持紧凑');
  assertTheme('form', generate());
  state.speech = { locked: true, configured: true, configPath: '/tmp/config', voice: { speaker: 'voice', speechRate: 0 }, operations: [], audio: [], tasks: [] };
  await action(() => [...intervals.values()].forEach(fn => fn()));
  check(generate().disabled, '任务锁禁用配音'); assertTheme('disabled', generate());
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
