import { test } from 'node:test';
import { chrome } from './helpers/browser.js';
import { fixture } from './helpers/editing-fixture.js';
import { checkInteractiveBrowser } from './helpers/interactive-browser.js';

const script = String.raw`
  import { act, StrictMode } from 'react';
  import { createRoot } from 'react-dom/client';
  import { App } from './src/panel/app.tsx';
  import { state, deferred } from 'editing-fixture';
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const intervals = new Map(); let nextTimer = 0;
  window.setInterval = callback => { const id = ++nextTimer; intervals.set(id, callback); return id; };
  window.clearInterval = id => intervals.delete(id);
  const result = document.getElementById('result');
  const check = (value, message) => { if (!value) throw Error(message); };
  const settle = () => new Promise(resolve => setTimeout(resolve, 40));
  const button = text => [...document.querySelectorAll('button')].find(node => node.textContent === text);
  const dialog = () => document.activeElement.closest('dialog[open]') ?? document.querySelector('dialog[open]');
  const field = label => document.querySelector('[aria-label="' + label + '"]');
  const click = async node => { await act(async () => { check(node && !node.disabled, '入口必须可用'); node.focus(); node.click(); await settle(); }); await settle(); };
  const visibleControl = async label => {
    for (let attempt = 0; attempt < 100; attempt++) { const node = field(label); if (node) return node; await settle(); }
    throw Error('表格虚拟滚动后入口未出现：' + label);
  };
  const key = async (key, shift = false) => { await act(async () => { await window.browserInput({ key, shift }); await settle(); }); await settle(); };
  const poll = async () => { await act(async () => { [...intervals.values()].forEach(callback => callback()); await settle(); }); await settle(); };
  const input = async (node, value) => { await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true })); await settle();
  }); };
  const cell = (id, column) => document.querySelector('[row-id="' + id + '"] [col-id="' + column + '"]');
  const screenshot = name => {
    const rect = dialog().getBoundingClientRect();
    check(rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight, '浮层必须完整位于视口内');
    check(dialog().scrollWidth <= dialog().clientWidth, '浮层不能横向溢出');
    return window.browserInput({ screenshot: name });
  };
  (async () => {
    try {
      state.status.snapshot.assets = [{ id: 'asset', name: '示例素材的长名称.mp4', duration: 60 }];
      state.status.snapshot.segments = Array.from({ length: 50 }, (_, index) => ({
        id: 'segment-' + index, order: index + 1, text: (index < 40 ? '保留' : '隐藏') + '片段 ' + (index + 1), video: { assetId: 'asset', start: 2 },
      }));
      state.speech = { locked: false, voice: { speaker: 'zh_female_vv_uranus_bigtts', speechRate: 0 }, configured: true, configPath: '/tmp/config', operations: [], tasks: [],
        audio: state.status.snapshot.segments.map(segment => ({ segmentId: segment.id, taskId: segment.id, valid: true, url: '/test-audio.wav', createdAt: '2026-10-03T00:00:00Z', input: { text: segment.text } })) };
      const root = createRoot(document.getElementById('root'));
      await act(async () => { root.render(<StrictMode><App /></StrictMode>); await settle(); });
      await settle();
      const settings = button('更多');
      await click(button('更多')); await click(button('导出设置'));
      check(dialog()?.getAttribute('aria-label') === '全片导出设置', '设置必须有可访问名称');
      check(dialog().contains(document.activeElement), '打开设置后焦点必须进入浮层');
      await screenshot('settings');
      for (let index = 0; index < 6; index++) {
        await key('Tab', index >= 3);
        check(dialog().contains(document.activeElement), 'Tab 和 Shift+Tab 不能离开浮层');
      }
      await key('Escape');
      check(!dialog() && document.activeElement === settings, 'Esc 关闭后必须恢复原入口');
      check(state.saves === 0 && state.leases.length === 0, '查看设置不能申请修改权或保存');
      await click(button('查找')); await input(field('查找文案'), '保留');
      const body = document.querySelector('.ag-body-vertical-scroll-viewport');
      const horizontal = document.querySelector('.ag-body-horizontal-scroll-viewport');
      check(body && horizontal, '必须找到真实表格的横纵滚动容器');
      body.scrollTop = 700; await settle();
      const rowId = 'segment-20';
      const checkbox = document.querySelector('[row-id="' + rowId + '"] input[type="checkbox"]');
      await click(checkbox);
      // 焦点移动也会触发表格滚动；等待该次手势结束后再操作横向滚动条。
      await new Promise(resolve => setTimeout(resolve, 200));
      horizontal.scrollLeft = 520; await settle();
      const before = JSON.stringify(state.status.snapshot.segments);
      const scrollTop = body.scrollTop, scrollLeft = horizontal.scrollLeft;
      const history = await visibleControl('展开片段 21 的保留音频');
      check(history, '真实 AG Grid 必须显示保留音频入口');
      cell(rowId, '1').focus(); await key('Tab');
      check(document.activeElement.tagName === 'BUTTON', 'Tab 应能从配音单元格进入按钮');
      field('展开片段 21 的保留音频').focus(); await key('Enter');
      check(dialog()?.getAttribute('aria-label') === '保留音频' && dialog().contains(document.activeElement), '键盘打开保留音频并进入浮层');
      await screenshot('audio-history');
      await poll();
      for (let index = 0; index < 10; index++) { await key('Tab', index >= 5); check(dialog().contains(document.activeElement), '音频原生控件也必须保持焦点范围'); }
      await key('Escape');
      check(document.activeElement === cell(rowId, '1'), '轮询重建后回到同一片段的配音单元格');
      check(body.scrollTop === scrollTop && horizontal.scrollLeft === scrollLeft, '查看详情不改变表格滚动位置');
      check(field('查找文案').value === '保留' && document.querySelector('[row-id="' + rowId + '"]').getAttribute('aria-selected') === 'true', '保留查找与勾选');
      check(JSON.stringify(state.status.snapshot.segments) === before && state.saves === 0 && state.mutations.length === 0, '只查看不能修改、提交、重试或计费');
      horizontal.scrollLeft = 250; await settle();
      const preview = cell(rowId, '0').querySelector('button');
      await click(preview); check(dialog()?.getAttribute('aria-label') === '视频预览', '素材单元格打开视频预览');
      await screenshot('video-preview');
      await key('Tab'); await key('Tab', true); check(dialog().contains(document.activeElement), '视频控件保持浮层焦点');
      await click(button('关闭预览'));
      check(document.activeElement === cell(rowId, '0'), '关闭预览回到画面素材单元格');
      horizontal.scrollLeft = 520; await settle();
      const listen = [...cell(rowId, '1').querySelectorAll('button')].find(node => node.textContent === '试听');
      await click(listen); check(dialog()?.getAttribute('aria-label') === '配音试听', '切换至配音试听');
      await key('Escape');
      check(state.saves === 0 && state.mutations.length === 0 && JSON.stringify(state.status.snapshot.segments) === before, '连续查看视频与试听不改变片段或触发任务');

      await click(button('更多')); await click(button('导出设置')); await click(button('编辑设置'));
      const lease = state.current;
      state.saveGate = deferred();
      await act(async () => { const fps = field('导出帧率'); fps.value = '60'; fps.dispatchEvent(new Event('change', { bubbles: true })); });
      await key('Escape');
      check(dialog() && button('关闭设置').disabled && state.current === lease && lease.closes === 0, '保存期间 Esc 不能绕过关闭限制或释放修改权');
      await key('Tab'); check(dialog().contains(document.activeElement), '保存时所有控件禁用仍有焦点落点：' + document.activeElement.outerHTML.slice(0, 150) + ' open=' + dialog().open);
      await screenshot('settings-saving');
      await act(async () => { state.saveGate.resolve(); state.saveGate = null; await settle(); });
      await input(field('字幕字号（px）'), '48'); field('字幕字号（px）').focus();
      await key('Escape');
      check(dialog() && dialog().textContent.includes('字号尚未保存'), '未提交字号不能被 Esc 丢弃');
      await key('Tab'); await key('Escape');
      check(!dialog() && lease.closes === 1 && state.status.snapshot.exportSettings.fontSize === 48, '保存完成后关闭并释放一次修改权');
      await poll();
      state.status.modification = { owner: 'codex' }; await poll();
      await click(button('更多')); await click(button('导出设置'));
      check(button('编辑设置').disabled, 'Codex 修改期间设置保持只读');
      await key('Escape'); state.status.modification = null; await poll();

      horizontal.scrollLeft = 250; await settle();
      const videoButton = async () => {
        await click([...cell(rowId, '0').querySelectorAll('button')].find(node => node.textContent === '详情'));
        return button('更改');
      };
      await click(await videoButton());
      check(dialog()?.getAttribute('aria-label') === '关联视频' && dialog().contains(document.activeElement), '异步取得修改权后进入素材调整');
      const videoLease = state.current;
      await input(field('播放起点（秒）'), '8');
      await screenshot('video-editor');
      await key('Escape');
      check(dialog()?.getAttribute('aria-label') === '画面素材详情' && videoLease.closes === 1 && state.status.snapshot.segments.find(segment => segment.id === rowId).video.start === 2, 'Esc 取消素材草稿并释放修改权');
      await key('Escape');
      check(document.activeElement === cell(rowId, '0'), '关闭详情后恢复素材单元格');
      await poll(); await click(await videoButton()); await input(field('播放起点（秒）'), '5');
      await click(button('保存关联与起点')); await settle();
      check(dialog()?.getAttribute('aria-label') === '画面素材详情' && state.status.snapshot.segments.find(segment => segment.id === rowId).video.start === 5, '素材保存保持原有行为');
      await key('Escape'); await poll();
      await click(button('更多')); await click(button('导入本地视频')); await input(field('视频文件绝对路径'), '/tmp/example.mp4');
      state.saveGate = deferred(); await click(button('导入并复制'));
      const oldSave = state.saveGate; state.saveGate = null; const importLease = state.current;
      await key('Escape');
      check(!dialog() && importLease.closes === 1, '处理期间 Esc 沿用已有取消路径并释放修改权');
      await poll(); await click(button('更多')); await click(button('导出设置')); await click(button('编辑设置'));
      const newLease = state.current;
      await act(async () => { oldSave.resolve(); await settle(); });
      check(state.current === newLease && newLease.closes === 0, '已取消处理的迟到结果不得释放新编辑');
      await key('Escape'); await poll();
      horizontal.scrollLeft = 250; await settle();
      state.acquireGate = deferred(); await click(await videoButton()); await key('Escape');
      horizontal.scrollLeft = 520; await settle();
      await click(field('展开片段 21 的保留音频'));
      await act(async () => { state.acquireGate.resolve(); state.acquireGate = null; await settle(); });
      check(document.querySelector('dialog[aria-label="关联视频"]').contains(document.activeElement), '异步打开素材调整时焦点进入最新浮层');
      await key('Escape');
      check(document.querySelector('dialog[aria-label="保留音频"]').contains(document.activeElement), '关闭上层后回到仍打开的音频详情');
      await key('Escape');
      check(document.activeElement === cell(rowId, '1') && !state.current, '最后关闭音频回到其原列且无遗留修改权');
      await click(field('展开片段 21 的保留音频'));
      const originalOrder = [...state.status.snapshot.segments];
      const moved = originalOrder.find(segment => segment.id === rowId);
      state.status.snapshot.segments = originalOrder.filter(segment => segment.id !== rowId);
      state.status.snapshot.segments.splice(10, 0, moved);
      await poll(); await key('Escape');
      // 行重排带有位移动画；等待真实可见位置，避免在动画中途判断恢复结果。
      for (let attempt = 0; attempt < 25; attempt++) {
        const rect = document.activeElement.getBoundingClientRect(), viewport = body.getBoundingClientRect();
        if (document.activeElement === cell(rowId, '1') && rect.top >= viewport.top && rect.bottom <= viewport.bottom) break;
        await settle();
      }
      const restoredRect = document.activeElement.getBoundingClientRect();
      const viewportRect = body.getBoundingClientRect();
      check(document.activeElement === cell(rowId, '1') && restoredRect.top >= viewportRect.top && restoredRect.bottom <= viewportRect.bottom, '合法重排到缓冲行后，恢复的单元格必须可见：' + JSON.stringify({ active: document.activeElement.outerHTML.slice(0, 150), restored: restoredRect.toJSON(), viewport: viewportRect.toJSON() }));
      await key('ArrowDown');
      check(document.activeElement.closest('[row-id]')?.getAttribute('row-id') === 'segment-10', '重排后继续从恢复的片段位置键盘导航');
      await key('ArrowUp');
      await click(field('展开片段 21 的保留音频'));
      state.status.snapshot.segments = originalOrder; await poll(); await key('Escape');
      await click(field('展开片段 21 的保留音频'));
      state.status.snapshot.segments = state.status.snapshot.segments.filter(segment => segment.id !== rowId);
      await poll(); await key('Escape');
      check(document.activeElement.closest('[row-id]')?.getAttribute('row-id') === 'segment-21', '原片段消失后返回邻近可用片段');
      await click(field('展开片段 22 的保留音频'));
      state.status.snapshot.segments = []; await poll(); await key('Escape');
      check(document.activeElement === button('查找'), '表格变空时回到可用的查找入口');
      result.dataset.state = 'passed'; result.textContent = '浮层键盘验证通过';
    } catch (error) { result.dataset.state = 'failed'; result.textContent = error.stack; }
  })();
`;
for (const width of [1600, 420]) {
  test(`真实主视图浮层键盘与焦点恢复（${width}px）`, {
    skip: chrome ? false : '未执行：需要 Chrome/Chromium', timeout: 40000,
  }, t => checkInteractiveBrowser(t, script, fixture, width));
}
