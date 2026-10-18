import { test } from './helpers/playwright-browser.js';
import { fixture } from './helpers/editing-fixture.js';

const script = String.raw`
  import { act } from 'react';
  import { createRoot } from 'react-dom/client';
  import { App } from './src/panel/app.tsx';
  import { state, deferred } from 'editing-fixture';
  import { assertTheme, assertKeyboardFocus } from './tests/helpers/theme-contract.ts';
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const intervals = new Map(); let timer = 0;
  window.setInterval = callback => { intervals.set(++timer, callback); return timer; };
  window.clearInterval = id => intervals.delete(id);
  const check = (value, message) => { if (!value) throw Error(message); };
  const settle = () => new Promise(resolve => setTimeout(resolve, 80));
  const button = (text, parent = document) => [...parent.querySelectorAll('button')].find(node => node.textContent === text || node.getAttribute('aria-label') === text);
  const click = async node => { check(node && !node.disabled, '入口可用：' + (node?.outerHTML ?? document.querySelector('[row-id="s1"]')?.textContent)); await act(async () => { node.focus(); if (node.hasAttribute('data-speech-more')) await window.browserInput({ click: '[aria-label="' + node.getAttribute('aria-label') + '"]' }); else node.click(); await settle(); }); await settle(); };
  const key = async key => { await act(async () => { await window.browserInput({ key }); await settle(); }); await settle(); };
  const poll = async () => { await act(async () => { [...intervals.values()].forEach(fn => fn()); await settle(); }); await settle(); };
  const cell = (id, col) => document.querySelector('[row-id="' + id + '"]' + (col === '1' ? '' : ' [col-id="' + col + '"]'));
  const dialog = () => document.activeElement.closest('[role="dialog"][aria-modal="true"]') ?? document.querySelector('[role="dialog"][aria-modal="true"]') ?? document.querySelector('aside');
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
      horizontal.scrollLeft = 600; await settle();
      const gridRect = document.querySelector('.segment-grid').getBoundingClientRect();
      await click(button('查看片段 1 的详情'));
      check(dialog()?.getAttribute('aria-label') === '口播片段详情' && dialog().textContent.includes(longName), '素材详情显示完整名称');
      check(state.leases.length === 0 && state.mutations.length === 0, '只读素材详情不申请修改权');
      await window.browserInput({ screenshot: 'material-detail' });
      await click(button('更改', dialog()));
      check(dialog()?.getAttribute('aria-label') === '关联视频', '从详情进入既有编辑');
      check(dialog().contains(document.activeElement), '更改入口禁用后焦点进入关联弹窗');
      await key('Escape');
      check(dialog()?.getAttribute('aria-label') === '口播片段详情' && dialog().contains(document.activeElement), '取消编辑回到详情');
      await key('Escape');
      check(document.activeElement === button('查看片段 1 的详情'), '关闭详情恢复行悬浮入口'); await poll();
      for (const [assetId, start] of [['', 0], ['asset', 4]]) {
        await click(button('查看片段 1 的详情')); await click(button(assetId ? '关联' : '更改', dialog()));
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
      check(cell('s1', '1').textContent.includes('结果未知'), '未知结果持续可见，完整警告可从保留音频访问');
      for (const [i, label] of [[2, '排队中'], [3, '生成中'], [5, '未生成']]) check(cell('s' + i, '1').textContent.includes(label), '状态可辨识：' + label);
      check(cell('s1','1').querySelectorAll('[role="status"]').length > 0, '配音状态可见性断言必须有真实目标');
      for (const span of cell('s1', '1').querySelectorAll('[role="status"]')) check(span.scrollWidth <= span.clientWidth && span.scrollHeight <= span.clientHeight, '异常不能截断或依赖悬停');
      for (const node of cell('s1', '1').querySelectorAll('[role="status"], button')) {
        const box = node.getBoundingClientRect(), bounds = cell('s1', '1').getBoundingClientRect();
        check(box.top >= bounds.top && box.bottom <= bounds.bottom, '状态和操作均在行内完整可见');
      }
      await window.browserInput({ screenshot: 'speech-states' });
      const before = state.mutations.length;
      await click(button('片段 2 配音更多操作', cell('s1', '1')));
      const menu = document.querySelector('[role="menu"][aria-label="片段 2 配音操作"]');
      assertTheme('menu', menu);
      const menuBox = menu.getBoundingClientRect();
      check(menuBox.left >= 0 && menuBox.right <= innerWidth && menuBox.top >= 0 && menuBox.bottom <= innerHeight, '配音菜单不越出视口');
      await key('ArrowDown'); assertKeyboardFocus(document.activeElement);
      await key('Escape');
      check(document.activeElement === button('片段 2 配音更多操作', cell('s1', '1')), '菜单 Escape 返回更多入口');
      await click(button('片段 2 配音更多操作', cell('s1', '1'))); await click(document.querySelector('[data-speech-history]'));
      check(dialog().textContent.includes('结果未知，可能已计费，请核对后再重试'), '详情提供完整任务信息');
      check(dialog().textContent.includes('配音待更新'), '历史音频标明待更新');
      await key('Escape');
      await click(button('试听', cell('s1', '1')));
      check(!dialog() && cell('s1','1').textContent.includes('配音待更新'), '单元格试听保持待更新状态且不打开详情');
      await click(button('试听', cell('s0', '1')));
      state.speech.audio[0].valid = false; await poll();
      check(cell('s0','1').textContent.includes('配音待更新'), '试听期间有效性跟随轮询');
      const retainedAudio = state.speech.audio;
      state.speech.audio = retainedAudio.filter(audio => audio.segmentId !== 's0'); await poll();
      check(!button('试听',cell('s0','1')) && !document.querySelector('main > audio'), '移除音频停止旧试听');
      state.speech.audio = retainedAudio; state.speech.audio[0].valid = true; await poll();
      check(state.mutations.length === before, '查看详情与试听不触发计费');
      check(document.querySelector('.segment-grid').getBoundingClientRect().top === gridRect.top, '浮层不推移表格');
      state.speechGate = deferred(); state.speechFailure = true;
      await click(button('片段 1 配音更多操作', cell('s0', '1')));
      await click(document.querySelector('[data-speech-generate]'));
      await click(button('片段 1 配音更多操作', cell('s0', '1')));
      check(document.querySelector('[data-speech-generate]').getAttribute('aria-disabled') === 'true', '提交期间重复入口禁用');
      await act(async () => { document.querySelector('[data-speech-generate]').click(); await settle(); });
      check(state.speechRequests.length === 1 && state.speechRequests[0].segmentId === 's0', '一次点击只提交当前片段一次');
      await act(async () => { state.speechGate.resolve(); state.speechGate = null; await settle(); });
      state.speechFailure = false; await click(document.querySelector('[data-speech-generate]'));
      check(state.speechRequests.length === 2 && state.speechRequests[0].requestId === state.speechRequests[1].requestId, '未知提交结果复用请求标识防止重复计费');
      state.speech.locked = true; await poll();
      await click(button('片段 1 配音更多操作', cell('s0', '1')));
      check(document.querySelector('[data-speech-generate]').getAttribute('aria-disabled') === 'true' && !button('试听', cell('s0', '1')).disabled, '锁定时禁止生成但允许试听');
      document.getElementById('result').dataset.state = 'passed';
    } catch (error) { document.getElementById('result').dataset.state = 'failed'; document.getElementById('result').textContent = error.stack; }
  })();
`;
for (const width of [1600, 420]) {
  test('素材和配音紧凑单元格及按需详情（' + width + 'px）', async ({ panel }) => { test.setTimeout(40000); return panel.check(script, fixture, width); });
}
