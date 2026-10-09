import { test } from 'node:test';
import { fixture } from './helpers/editing-fixture.js';
import { checkInteractiveBrowser } from './helpers/interactive-browser.js';

const script = String.raw`
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './src/panel/app.tsx';
import { state } from 'editing-fixture';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const check = (ok, message) => { if (!ok) throw Error(message); };
const settle = () => new Promise(resolve => setTimeout(resolve, 160));
(async () => { try {
  state.status.snapshot.segments = [
    '工作空间绑定验收：.3 重载后面板与 MCP 双向复核通过。',
    'SPEC41 乙：另一个对话的勾选修改已验证。',
    '这是一次专用的后台制作验收。我们正在确认，口播项目能够可靠地归属于当前工作空间。',
    'SPEC41 甲：当前对话的勾选修改已验证。',
    '这是一段专门用于后台运行验证的测试口播。下面按照三个观察阶段重复说明同一组要求。',
  ].map((text, index) => ({ id: 's' + index, order: index + 1, text, visualNote: '', video: null }));
  state.speech = { locked: false, configured: true, voice: { speaker: 'voice', speechRate: 0 }, operations: [],
    tasks: [{ id: 'running', requestId: 'r0', segmentId: 's2', state: 'running', message: '正在生成' }, { id: 'failed', requestId: 'r1', segmentId: 's4', state: 'failed', message: '生成失败' }],
    audio: [0, 1].map(index => ({ segmentId: 's' + index, taskId: 'a' + index, valid: index === 0, url: '/test.wav', createdAt: '2026-10-09T00:00:00Z', input: { text: '文案' } })) };
  await act(async () => { createRoot(document.getElementById('root')).render(<App />); await settle(); }); await settle();
  const horizontal = document.querySelector('.ag-body-horizontal-scroll-viewport');
  if (innerWidth < 600) { horizontal.scrollLeft = 500; await settle(); }
  for (const [index, label] of [[0, '有效配音'], [1, '配音待更新'], [2, '生成中'], [3, '未生成'], [4, '生成失败']]) {
    const region = document.querySelector('[aria-label="片段 ' + (index + 1) + ' 配音"]');
    const controls = region.querySelector('[role="group"]');
    const status = region.querySelector('[role="status"]');
    check(controls.querySelectorAll('button').length === 2, '每行只有主按钮和更多入口');
    check(controls.getBoundingClientRect().bottom <= status.getBoundingClientRect().top, '主操作在状态上方');
    check(region.textContent.includes(label), '保留状态：' + label);
    const cell = region.closest('[role="gridcell"]');
    check(cell.getBoundingClientRect().width === 118 && region.closest('[row-id]').getBoundingClientRect().height === 80, '保持配音列宽与行高');
    for (const button of controls.querySelectorAll('button')) {
      const bounds = button.getBoundingClientRect(), cellBounds = cell.getBoundingClientRect();
      check(bounds.left >= cellBounds.left && bounds.right <= cellBounds.right, '按钮不横向溢出单元格');
      check(button.scrollWidth <= button.clientWidth, '按钮文字完整可见');
    }
  }
  check(document.querySelector('[row-id="s2"] [aria-label="生成中"]').disabled, '生成中主按钮禁用');
  check(!document.querySelector('[row-id="s0"] [data-speech-generate]'), '重新生成只在展开菜单后出现');
  check((state.speechRequests ?? []).length === 0, '查看不产生制作请求');
  await window.browserInput({ screenshot: 'speech-cell-choice3' });
  document.getElementById('result').dataset.state = 'passed';
} catch (error) { document.getElementById('result').dataset.state = 'failed'; document.getElementById('result').textContent = error.stack; } })();
`;
for (const [width, height] of [[780, 579], [420, 360]]) {
  test(`配音主按钮在上、状态在下及单元格边界（${width}×${height}）`, { timeout: 30000 }, t => checkInteractiveBrowser(t, script, fixture, width, height));
}
