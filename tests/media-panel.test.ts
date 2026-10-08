import { test } from 'node:test';
import { chrome } from './helpers/browser.js';
import { fixture } from './helpers/editing-fixture.js';
import { checkInteractiveBrowser } from './helpers/interactive-browser.js';

const script = String.raw`
  import { act } from 'react';
  import { createRoot } from 'react-dom/client';
  import { App } from './src/panel/app.tsx';
  import { state, deferred } from 'editing-fixture';
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const intervals = new Map(); let timer = 0;
  window.setInterval = callback => { intervals.set(++timer, callback); return timer; };
  window.clearInterval = id => intervals.delete(id);
  const check = (value, message) => { if (!value) throw Error(message); };
  const settle = () => new Promise(resolve => setTimeout(resolve, 80));
  const button = (text, parent = document) => [...parent.querySelectorAll('button')].find(node => node.textContent === text);
  const click = async node => { check(node && !node.disabled, '入口可用：' + (node?.outerHTML ?? document.querySelector('[row-id="s1"]')?.textContent)); await act(async () => { node.focus(); node.click(); await settle(); }); await settle(); };
  const key = async key => { await act(async () => { await window.browserInput({ key }); await settle(); }); await settle(); };
  const poll = async () => { await act(async () => { [...intervals.values()].forEach(fn => fn()); await settle(); }); await settle(); };
  const cell = (id, col) => document.querySelector('[row-id="' + id + '"] [col-id="' + col + '"]');
  const dialog = () => document.activeElement.closest('dialog[open], [role="dialog"][aria-modal="true"]') ?? document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]');
  (async () => {
    try {
      const longName = '素材长名称_用于确认名称不会挤压文案列_'.repeat(8) + '.mp4';
      state.status.snapshot.assets = [{ id: 'asset', name: longName, duration: 60 }];
      state.status.snapshot.segments = Array.from({ length: 6 }, (_, i) => ({ id: 's' + i, order: i + 1, text: '口播片段 ' + (i + 1), video: { assetId: 'asset', start: 2 } }));
      state.speech = { locked: false, configured: true, voice: { speaker: 'zh_female_vv_uranus_bigtts', speechRate: 0 }, operations: [],
        tasks: ['failed', 'unknown', 'accepted', 'running', 'succeeded'].map((value, i) => ({ id: 't' + i, requestId: 'r' + i, segmentId: 's' + i, state: value, message: value === 'unknown' ? '结果未知，可能已计费，请核对后再重试' : '任务的完整说明 ' + value })),
        audio: [0, 1].map(i => ({ segmentId: 's' + i, taskId: 'old' + i, valid: i === 0, url: '/test.wav', createdAt: '2026-10-03T00:00:00Z', input: { text: '旧文案' } })) };
      await act(async () => { createRoot(document.getElementById('root')).render(<App />); await settle(); }); await settle();
      const horizontal = document.querySelector('.ag-body-horizontal-scroll-viewport');
      if (innerWidth > 1000) check(cell('s0', 'text').getBoundingClientRect().width > 600, '精简后文案获得剩余宽度');
      horizontal.scrollLeft = 300; await settle();
      const gridRect = document.querySelector('.segment-grid').getBoundingClientRect();
      await click(button('详情', cell('s0', '0')));
      check(dialog()?.getAttribute('aria-label') === '画面素材详情' && dialog().textContent.includes(longName), '素材详情显示完整名称');
      check(state.leases.length === 0 && state.mutations.length === 0, '只读素材详情不申请修改权');
      await window.browserInput({ screenshot: 'material-detail' });
      await click(button('更改', dialog()));
      check(dialog()?.getAttribute('aria-label') === '关联视频', '从详情进入既有编辑');
      await key('Escape');
      check(dialog()?.getAttribute('aria-label') === '画面素材详情' && dialog().contains(document.activeElement), '取消编辑回到详情');
      await key('Escape');
      check(document.activeElement === cell('s0', '0'), '关闭详情恢复素材单元格'); await poll();
      for (const [assetId, start] of [['', 0], ['asset', 4]]) {
        await click(button('详情', cell('s0', '0'))); await click(button(assetId ? '关联' : '更改', dialog()));
        await act(async () => {
          const select = document.querySelector('[aria-label="关联素材"]'); select.value = assetId; select.dispatchEvent(new Event('change', { bubbles: true })); await settle();
        });
        if (assetId) await act(async () => {
          const input = document.querySelector('[aria-label="播放起点（秒）"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(start)); input.dispatchEvent(new Event('input', { bubbles: true })); await settle();
        });
        await click(button('保存关联与起点', dialog()));
        const change = state.batchRequests.at(-1).changes[0];
        check(change.kind === 'video' && change.assetId === (assetId || null) && (!assetId || change.start === start), '通过既有请求关联、解除关联和调整起点');
        await key('Escape'); await poll();
      }
      horizontal.scrollLeft = 520; await settle();
      check(cell('s0', '1').textContent.includes('有效配音') && cell('s0', '1').textContent.includes('生成失败'), '有效音频与最近失败独立显示');
      check(cell('s1', '1').textContent.includes('结果未知，可能已计费'), '未知结果保留完整计费警告');
      for (const [i, label] of [[2, '已受理'], [3, '生成中'], [5, '配音缺失']]) check(cell('s' + i, '1').textContent.includes(label), '状态可辨识：' + label);
      for (const span of cell('s1', '1').querySelectorAll('[aria-label="配音状态"] span')) check(span.scrollWidth <= span.clientWidth && span.scrollHeight <= span.clientHeight, '异常不能截断或依赖悬停');
      for (const node of cell('s1', '1').querySelectorAll('[aria-label="配音状态"] span, button')) {
        const box = node.getBoundingClientRect(), bounds = cell('s1', '1').getBoundingClientRect();
        check(box.top >= bounds.top && box.bottom <= bounds.bottom, '状态和操作均在行内完整可见');
      }
      await window.browserInput({ screenshot: 'speech-states' });
      const before = state.mutations.length;
      await click(button('详情', cell('s1', '1')));
      check(dialog().textContent.includes('结果未知，可能已计费，请核对后再重试'), '详情提供完整任务信息');
      check(dialog().textContent.includes('配音待更新'), '历史音频标明待更新');
      await key('Escape');
      await click(button('试听（待更新）', cell('s1', '1')));
      check(dialog().textContent.includes('配音待更新'), '试听浮层持续标明待更新');
      await key('Escape');
      await click(button('试听', cell('s0', '1')));
      state.speech.audio[0].valid = false; await poll();
      check(dialog().textContent.includes('配音待更新'), '试听期间外部更新后可用性跟随轮询');
      const retainedAudio = state.speech.audio;
      state.speech.audio = retainedAudio.filter(audio => audio.segmentId !== 's0'); await poll();
      check(dialog().textContent.includes('配音状态无法确认'), '音频移除后不保留错误的有效性声明');
      await key('Escape'); state.speech.audio = retainedAudio; state.speech.audio[0].valid = true; await poll();
      check(state.mutations.length === before, '查看详情与试听不触发计费');
      check(document.querySelector('.segment-grid').getBoundingClientRect().top === gridRect.top, '浮层不推移表格');
      state.speechGate = deferred(); state.speechFailure = true;
      await click(button('重试配音', cell('s0', '1')));
      check(button('重试配音', cell('s0', '1')).disabled, '提交期间重复入口禁用');
      await act(async () => { button('重试配音', cell('s0', '1')).click(); await settle(); });
      check(state.speechRequests.length === 1 && state.speechRequests[0].segmentId === 's0', '一次点击只提交当前片段一次');
      await act(async () => { state.speechGate.resolve(); state.speechGate = null; await settle(); });
      state.speechFailure = false; await click(button('重试配音', cell('s0', '1')));
      check(state.speechRequests.length === 2 && state.speechRequests[0].requestId === state.speechRequests[1].requestId, '未知提交结果复用请求标识防止重复计费');
      state.speech.locked = true; await poll();
      check(button('重试配音', cell('s0', '1')).disabled && !button('试听', cell('s0', '1')).disabled, '锁定时禁止生成但允许试听');
      document.getElementById('result').dataset.state = 'passed';
    } catch (error) { document.getElementById('result').dataset.state = 'failed'; document.getElementById('result').textContent = error.stack; }
  })();
`;
for (const width of [1600, 420]) {
  test('素材和配音紧凑单元格及按需详情（' + width + 'px）', { skip: chrome ? false : '未执行：需要 Chrome/Chromium', timeout: 40000 }, t => checkInteractiveBrowser(t, script, fixture, width));
}
