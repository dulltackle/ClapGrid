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
  window.setInterval = callback => { intervals.set(++timer, callback); return timer; };
  window.clearInterval = id => intervals.delete(id);
  const check = (value, message) => { if (!value) throw Error(message); };
  const settle = () => new Promise(resolve => setTimeout(resolve, 50));
  const button = text => [...document.querySelectorAll('button')].find(node => node.textContent === text);
  const click = async text => { await act(async () => { const node = button(text); check(node && !node.disabled, '入口可用：' + text); node.focus(); node.click(); await settle(); }); await settle(); };
  const key = async key => { await act(async () => { await window.browserInput({ key }); await settle(); }); await settle(); };
  const dialog = () => document.querySelector('dialog[open]');
  const rect = () => document.querySelector('[role="grid"]').closest('.grid').getBoundingClientRect();
  const shot = name => window.browserInput({ screenshot: name });
  (async () => {
    try {
      state.status.snapshot.segments = Array.from({ length: 60 }, (_, i) => ({ id: 's-' + i, order: i + 1, text: '口播片段 ' + (i + 1), video: null }));
      await act(async () => { createRoot(document.getElementById('root')).render(<App />); await settle(); }); await settle();
      check(button('更多'), '低频入口收拢到更多');
      check(!button('导出设置') && !document.querySelector('[aria-label="统一音色"]'), '正常编辑不堆叠设置');
      check(button('导出全片') && button('新增口播片段'), '主要操作常驻');
      const initial = rect();
      check(initial.top < innerHeight * .3 && initial.height > innerHeight * .5, '表格占据主要空间且表头直接可见');
      check(document.documentElement.scrollHeight <= innerHeight, '页面无额外纵向滚动');
      const vertical = document.querySelector('.ag-body-vertical-scroll-viewport');
      const horizontal = document.querySelector('.ag-body-horizontal-scroll-viewport');
      check(vertical.scrollHeight > vertical.clientHeight, '多片段由表格内部纵向滚动');
      if (innerWidth < 600) check(horizontal.scrollWidth > horizontal.clientWidth, '窄面板保留内部横向滚动');
      const headers = new Set();
      for (let left = 0; left <= horizontal.scrollWidth; left += 200) {
        horizontal.scrollLeft = left; await settle();
        document.querySelectorAll('[role="columnheader"] .ag-header-cell-text').forEach(node => headers.add(node.textContent.trim()));
      }
      horizontal.scrollLeft = 0; await settle();
      check(['序号', '文案', '画面素材', '配音', '画面说明'].every(name => headers.has(name)), '五个业务列均保留');
      await shot('normal');
      for (const [entry, label] of [['声音设置', '统一声音设置'], ['导出设置', '全片导出设置'], ['粘贴多行文案', '粘贴多行文案'], ['任务记录', '任务记录'], ['导入本地视频', '导入本地视频']]) {
        await click('更多'); await click(entry);
        check(dialog()?.getAttribute('aria-label') === label, '打开有名称的浮层：' + label);
        check(dialog().contains(document.activeElement), '焦点进入浮层');
        check(rect().top === initial.top && rect().height === initial.height, '详情不推移表格：' + label + ' ' + JSON.stringify({ before: initial.toJSON(), after: rect().toJSON() }));
        const bounds = dialog().getBoundingClientRect();
        check(bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && dialog().scrollWidth <= dialog().clientWidth, '浮层不溢出');
        await shot(entry === '任务记录' ? 'tasks' : 'detail-' + label);
        await key('Escape');
        check(!dialog() && document.activeElement === button('更多'), '关闭迁移详情返回更多');
      }
      await click('连接诊断'); check(dialog()?.getAttribute('aria-label') === '连接诊断', '状态入口打开诊断');
      check(dialog().textContent.includes('/tmp/project'), '可查看项目路径'); await key('Escape');
      check(state.saves === 0 && state.mutations.length === 0, '仅查看详情不提交任务或设置');
      check(!state.current, '取消导入释放修改权');
      document.getElementById('result').dataset.state = 'passed';
    } catch (error) { document.getElementById('result').dataset.state = 'failed'; document.getElementById('result').textContent = error.stack; }
  })();
`;
for (const width of [1600, 420]) {
  test(`主视图入口迁移与剩余空间布局（${width}px）`, {
    skip: chrome ? false : '未执行：需要 Chrome/Chromium', timeout: 40000,
  }, t => checkInteractiveBrowser(t, script, fixture, width));
}

test('读取状态及迁移表单保留保存、取消与互斥规则', {
  skip: chrome ? false : '未执行：需要 Chrome/Chromium', timeout: 40000,
}, t => checkInteractiveBrowser(t, String.raw`
  import { act } from 'react';
  import { createRoot } from 'react-dom/client';
  import { App } from './src/panel/app.tsx';
  import { state, deferred } from 'editing-fixture';
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const intervals = new Map(); let timer = 0;
  window.setInterval = callback => { intervals.set(++timer, callback); return timer; };
  window.clearInterval = id => intervals.delete(id);
  const check = (value, message) => { if (!value) throw Error(message); };
  const settle = () => new Promise(resolve => setTimeout(resolve, 50));
  const button = text => [...document.querySelectorAll('button')].find(node => node.textContent === text);
  const click = async text => { await act(async () => { const node = button(text); check(node && !node.disabled, '按钮可用：' + text); node.focus(); node.click(); await settle(); }); await settle(); };
  const key = async key => { await act(async () => { await window.browserInput({ key }); await settle(); }); await settle(); };
  const poll = async () => { await act(async () => { [...intervals.values()].forEach(callback => callback()); await settle(); }); };
  const field = label => document.querySelector('[aria-label="' + label + '"]');
  const change = async (label, value) => { await act(async () => { const node = field(label); node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); await settle(); }); };
  const alerts = () => document.querySelector('footer').textContent;
  (async () => {
    try {
      state.delayQuery = true;
      await act(async () => { createRoot(document.getElementById('root')).render(<App />); await settle(); }); await settle();
      check(document.querySelector('.grid').textContent.includes('正在连接本地服务') && !document.querySelector('.grid').textContent.includes('暂无口播片段'), '首次加载与空项目区分');
      state.delayQuery = false; state.statusFailure = true;
      await act(async () => { state.queries.splice(0).forEach(item => item.gate.resolve()); }); await poll();
      check(document.querySelector('.grid').textContent.includes('暂时无法读取口播片段'), '读取失败有专用提示');
      state.statusFailure = false; state.status.snapshot.segments = []; await poll();
      check(document.querySelector('.grid').textContent.includes('暂无口播片段'), '成功空项目有专用提示');
      await click('更多'); await click('导出设置'); await click('编辑设置');
      state.saveFailure = true; await change('导出帧率', '60');
      await click('关闭设置'); await poll();
      check(alerts().includes('设置保存失败'), '关闭设置后保存失败持续可见');
      await click('更多'); await click('导出设置'); await click('关闭设置');
      check(alerts().includes('设置保存失败'), '只查看不能清除设置错误');
      await click('更多'); await click('导出设置'); await click('编辑设置');
      state.saveFailure = false; await change('导出帧率', '60'); await click('关闭设置'); await poll();
      check(!alerts().includes('设置保存失败'), '主动成功保存后清除对应错误');
      await click('更多'); await click('粘贴多行文案');
      await act(async () => { const node = field('多行文案'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(node, '第一段\n\n第二段'); node.dispatchEvent(new Event('input', { bubbles: true })); });
      state.batchFailure = true; await click('按非空行新增');
      check(document.querySelector('dialog [role="alert"]')?.textContent.includes('多行新增失败'), '新增失败在当前浮层内可访问');
      state.batchFailure = false;
      state.saveGate = deferred(); await click('按非空行新增');
      await key('Escape'); check(document.querySelector('dialog[open]') && button('按非空行新增').disabled, '新增提交中阻止重复操作和关闭');
      await act(async () => { state.saveGate.resolve(); state.saveGate = null; await settle(); });
      check(state.status.snapshot.segments.length === 2 && field('多行文案').value === '', '按非空行新增并清空已提交文案');
      await key('Escape'); await poll(); check(!state.current, '新增结束释放修改权');
      state.speech = { locked: false, configured: true, configPath: '/tmp/config', voice: { speaker: 'zh_female_vv_uranus_bigtts', speechRate: 0 }, audio: [], tasks: [], operations: [] }; await poll();
      await click('更多'); await click('声音设置');
      state.voiceFailure = true; await change('统一语速', '20');
      check(document.querySelector('dialog [role="alert"]')?.textContent.includes('声音保存失败'), '声音保存失败在当前浮层内可访问');
      state.voiceFailure = false; state.saveGate = deferred();
      await change('统一语速', '20'); await key('Escape');
      check(document.querySelector('dialog[open]') && field('统一音色').disabled, '声音提交中保留互斥和浮层');
      await act(async () => { state.saveGate.resolve(); state.saveGate = null; await settle(); });
      check(field('统一语速').value === '20', '声音即时保存生效'); await key('Escape');
      document.getElementById('result').dataset.state = 'passed';
    } catch (error) { document.getElementById('result').dataset.state = 'failed'; document.getElementById('result').textContent = error.stack; }
  })();
`, fixture));
