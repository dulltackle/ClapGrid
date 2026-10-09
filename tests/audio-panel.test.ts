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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const intervals = new Map(); let timer = 0;
  window.setInterval = fn => { intervals.set(++timer, fn); return timer; };
  window.clearInterval = id => intervals.delete(id);
  const check = (value, message) => { if (!value) throw Error(message); };
  const settle = () => new Promise(resolve => setTimeout(resolve, 80));
  const button = (text, parent = document) => [...parent.querySelectorAll('button')].find(node => node.textContent === text || node.getAttribute('aria-label') === text);
  const click = async node => { check(node && !node.disabled, '入口可用'); await act(async () => { node.focus(); node.click(); await settle(); }); await settle(); };
  const key = async (key, shift = false) => { await act(async () => { await window.browserInput({ key, shift }); await settle(); }); await settle(); };
  const poll = async () => { await act(async () => { [...intervals.values()].forEach(fn => fn()); await settle(); }); await settle(); };
  const dialog = () => document.querySelector('[role="dialog"][aria-modal="true"]');
  const cell = () => document.querySelector('[row-id="segment"] [col-id="1"]');
  const description = node => document.getElementById(node.getAttribute('aria-describedby'))?.textContent;
  (async () => {
    try {
      const longText = '完整保留的文案与换行。\n' + '长文案'.repeat(200);
      // 有效的 PCM WAV 由浏览器原生媒体控件实际加载，不替换播放器。
      const wav = new Uint8Array(44 + 32000), view = new DataView(wav.buffer);
      const ascii = (offset, text) => { for (let i = 0; i < text.length; i++) wav[offset + i] = text.charCodeAt(i); };
      ascii(0, 'RIFF'); view.setUint32(4, wav.length - 8, true); ascii(8, 'WAVEfmt '); view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, 32000, true);
      const audioUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      state.speech = { locked: false, configured: true, voice: { speaker: 'zh_female_vv_uranus_bigtts', speechRate: 0 }, operations: [],
        tasks: ['failed', 'unknown'].map((value, i) => ({ id: 't' + i, requestId: 'r' + i, segmentId: 'segment', state: value, message: '完整任务说明' + i })),
        audio: [0, 1].map(i => ({ segmentId: 'segment', taskId: 'a' + i, valid: i === 1, url: audioUrl, createdAt: '2026-10-03T00:00:00Z', input: { text: i === 1 ? longText : '旧文案' } })) };
      await act(async () => { createRoot(document.getElementById('root')).render(<App />); await settle(); }); await settle();
      document.querySelector('.ag-body-horizontal-scroll-viewport').scrollLeft = 520; await settle();
      await click(button('展开片段 1 的保留音频', cell()));
      check(description(dialog())?.includes('配音任务记录'), '保留音频有可访问标题与说明');
      check(dialog().getAttribute('aria-labelledby') && document.getElementById(dialog().getAttribute('aria-labelledby')).textContent === '配音详情与保留音频', '标题关联正确');
      const history = dialog();
      check(history.textContent.indexOf('完整任务说明1') < history.textContent.indexOf('完整任务说明0'), '任务保持新到旧的顺序');
      const records = [...history.querySelectorAll('li')];
      check(records.length === 2 && records[0].textContent.includes(longText) && records[1].textContent.includes('旧文案'), '保留完整文案且音频新到旧排列');
      check(getComputedStyle(records[0].querySelector('audio')).width === getComputedStyle(records[0]).width, '媒体适配可用宽度');
      check(history.scrollWidth <= history.clientWidth, '长文案不产生横向溢出');
      check(getComputedStyle(history).backgroundColor === 'rgb(255, 255, 255)' && getComputedStyle(history).color === 'rgb(26, 28, 31)', '保持亮色主题');
      for (let i = 0; i < 12; i++) { await key('Tab', i > 5); check(history.contains(document.activeElement), '原生音频的 Tab 与 Shift+Tab 保持模态隔离'); }
      state.status.taskLocked = true; state.status.modification = { owner: 'other', kind: 'agent' }; await poll();
      check(history.contains(document.activeElement) && !button('关闭', history).disabled, '任务锁和修改占用变化后只读操作可关闭');
      history.focus();
      for (let i = 0; i < 16 && document.activeElement !== button('关闭', history); i++) await key('Tab');
      check(document.activeElement === button('关闭', history), 'Tab 可到达关闭操作');
      const box = button('关闭', history).getBoundingClientRect();
      check(box.top >= 0 && box.bottom <= innerHeight, '窄矮视口关闭操作可达：' + JSON.stringify({ box: box.toJSON(), height: innerHeight, dialog: history.getBoundingClientRect().toJSON(), scroll: history.scrollTop, scrollHeight: history.scrollHeight }));
      await window.browserInput({ screenshot: 'audio-history-' + innerHeight });
      await key('Escape');
      check(document.activeElement === cell(), '锁变化后回到稳定片段单元格');
      await click(button('试听', cell()));
      check(!dialog(), '表格试听不打开弹窗');
      const player = document.querySelector('main > audio');
      for (let i = 0; i < 20 && player.readyState < 1; i++) await settle();
      check(player.duration === 2 && !player.paused, '原生播放器实际读取并播放 WAV');
      check(document.activeElement?.getAttribute('aria-label') === '暂停试听', '播放后焦点保留在原暂停按钮');
      await click(button('暂停试听', cell())); check(player.paused, '单元格暂停实际媒体'); check(document.activeElement?.getAttribute('aria-label') === '试听', '暂停后仍保留图标焦点');
      await click(button('试听', cell())); check(!player.paused, '可以恢复试听');
      await click(button('展开片段 1 的保留音频', cell()));
      const historyPlayer = dialog().querySelector('audio');
      await act(async () => { await historyPlayer.play(); await settle(); });
      check(player.paused && !historyPlayer.paused, '播放保留音频停止表格试听');
      historyPlayer.focus(); await key('ArrowDown');
      check(historyPlayer.volume < 1, '原生播放器方向键可调音量');
      await key('Escape');
      state.speech.audio = []; await poll();
      check(!document.querySelector('main > audio'), '轮询移除音频后停止并移除旧播放');
      await click(button('展开片段 1 的保留音频', cell()));
      check(dialog().textContent.includes('暂无保留音频'), '空历史保留明确提示');
      await act(async () => { button('关闭', dialog()).click(); });
      button('更多').focus(); await settle();
      check(document.activeElement === button('更多'), '关闭后用户转向其他入口时不抢回旧片段');
      URL.revokeObjectURL(audioUrl);
      check(state.leases.length === 0 && state.mutations.length === 0, '只读音频不申请修改权且不产生制作请求');
      document.getElementById('result').dataset.state = 'passed';
    } catch (error) { document.getElementById('result').dataset.state = 'failed'; document.getElementById('result').textContent = error.stack; }
  })();
`;
for (const [width, height] of [[1600, 1000], [420, 800], [360, 320]]) {
  test('配音试听与保留音频完整主视图流程（' + width + '×' + height + '）', { timeout: 40000 }, async t => {
    assert.ok(chrome, '必须运行 Chrome，不将环境缺失视为通过');
    await checkInteractiveBrowser(t, script, fixture, width, height);
  });
}
