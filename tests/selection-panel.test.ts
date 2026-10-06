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
  const settle = () => new Promise(resolve => setTimeout(resolve, 80));
  const action = async callback => { await act(async () => { await callback(); await settle(); }); await new Promise(resolve => setTimeout(resolve, 200)); };
  const button = text => [...document.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') ?? node.textContent) === text);
  const click = async text => { if (['项目顺序上移', '项目顺序下移'].includes(text) && !button(text)) await action(() => window.browserInput({ click: '[aria-haspopup="menu"]' })); return action(() => { const node = button(text); check(node && !node.disabled, '入口可用：' + text); if (node.getAttribute('role') === 'menuitem') return window.browserInput({ click: '[role="menuitem"][aria-label="' + text + '"]' }); node.click(); }); };
  const select = async id => { await action(() => { const node = document.querySelector('[row-id="' + id + '"] input[type="checkbox"]'); check(node, '可见片段：' + id); node.click(); }); const trigger = document.querySelector('[aria-haspopup="menu"]'); if (trigger && trigger.getAttribute('aria-expanded') === 'false') await action(() => window.browserInput({ click: '[aria-haspopup="menu"]' })); };
  const filter = value => action(() => { const node = document.querySelector('[aria-label="查找文案"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); });
  const scope = () => (document.querySelector('[aria-label="组织口播片段"]')?.textContent ?? '').replace(/已选 (\d+) 项/, '已勾选 $1 个片段');
  const hidden = () => check(!button('删除勾选') && !button('项目顺序上移') && !button('项目顺序下移') && !scope().includes('已勾选'), '无勾选时收起数量及批量操作');
  (async () => {
    try {
      state.status.snapshot.segments = [
        { id: 'a', order: 1, text: '丙 第一段', video: null },
        { id: 'b', order: 2, text: '乙 第二段', video: null },
        { id: 'c', order: 3, text: '甲 第三段', video: null },
      ];
      await action(() => createRoot(document.getElementById('root')).render(<App />));
      hidden();
      const geometry = () => { const r = document.querySelector('.grid').getBoundingClientRect(); return [r.top, r.height]; };
      const initialGeometry = JSON.stringify(geometry());
      await select('a');
      check(JSON.stringify(geometry()) === initialGeometry, '单选原位工具栏不推移或缩小表格');
      check(button('取消选择'), '提供明确取消选择入口');
      await select('b');
      check(JSON.stringify(geometry()) === initialGeometry, '多选不改变表格几何尺寸');
      check(!button('项目顺序上移') && !button('项目顺序下移'), '多选不能执行单片段移动');
      check(document.documentElement.scrollWidth <= innerWidth, '选择工具栏无页面横向溢出');
      const controls = [...document.querySelectorAll('header button:not([hidden])')];
      check(controls.every(node => { const r = node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), '选择入口均位于视口内');
      await action(() => window.browserInput({ click: 'header [aria-haspopup="dialog"]' }));
      check(button('更多').getAttribute('aria-expanded') === 'true', '更多明确展开状态');
      check(JSON.stringify(geometry()) === initialGeometry, '更多浮层不改变表格');
      await action(() => window.browserInput({ key: 'Tab' }));
      check(document.activeElement.textContent === '新增口播片段', '键盘进入更多首项');
      await action(() => window.browserInput({ key: 'Tab' }));
      check(document.activeElement.textContent === '导出全片', '键盘导航至全片导出');
      await action(() => window.browserInput({ key: 'Enter' }));
      check(state.exportRequests.length === 1 && state.exportRequests[0].length === 1, '导出仅传服务地址，不传选择或筛选范围');
      check(scope().includes('已勾选 2 个片段'), '全片导出保留选择');
      await action(() => window.browserInput({ click: 'header [aria-haspopup="dialog"]' }));
      await action(() => window.browserInput({ key: 'Escape' }));
      check(!document.querySelector('dialog[open]') && document.activeElement === button('更多'), 'Esc 仅关闭更多并恢复入口焦点');
      check(scope().includes('已勾选 2 个片段') && button('更多').getAttribute('aria-expanded') === 'false', 'Esc 不穿透取消选择');
      await action(() => window.browserInput({ click: 'header [aria-haspopup="dialog"]' }));
      for (let index = 0; index < 3; index++) await action(() => window.browserInput({ key: 'Tab' }));
      check(document.activeElement.textContent === '查找', '选择中可从更多键盘访问查找');
      await action(() => window.browserInput({ key: 'Enter' }));
      check(document.activeElement === document.querySelector('[aria-label="查找文案"]'), '更多转查找最终聚焦输入框');
      await action(() => window.browserInput({ key: 'Escape' }));
      check(document.activeElement === button('更多') && scope().includes('已勾选 2 个片段'), '关闭查找恢复可见入口且保留选择');
      await click('取消选择'); hidden();
      check(JSON.stringify(state.selectionRequests.at(-1)) === '[]', '取消通过既有选择通道同步空选择');
      check(JSON.stringify(geometry()) === initialGeometry, '取消恢复工具栏且表格不跳动');
      await click('查找'); check(document.querySelector('[aria-label="查找文案"]'), '查找入口可用');
      await window.browserInput({ screenshot: 'unselected' });
      await select('a'); check(button('已选 1 项'), '查找同一行提供选择菜单入口');
      check(JSON.stringify(geometry()) === initialGeometry, '查找单选不改变表格几何尺寸');
      await select('a'); hidden();
      await select('a'); await select('b');
      check(!button('项目顺序上移') && !button('项目顺序下移'), '多选不允许移动');
      await filter('第二段');
      check(document.querySelector('[row-id="a"]') && scope().includes('已勾选 2 个片段'), '查找保留全部片段及勾选计数');
      check(JSON.stringify(state.selectionRequests.at(-1).sort()) === '["a","b"]', '查找不改变同步勾选范围');
      check(document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight, '勾选工具栏在宽窄视口内换行且无页面溢出');
      await window.browserInput({ screenshot: 'selected-filtered' });
      await action(() => document.querySelector('.ag-header input[type="checkbox"]').click());
      check(scope().includes('已勾选 3 个片段'), '查找时表头全选全部片段');
      await select('c');
      await click('删除勾选');
      check(JSON.stringify(state.batchRequests.at(-1).changes.map(item => item.expected.id)) === '["a","b"]', '删除请求包含全部勾选片段');
      hidden(); await filter('');
      check(document.querySelector('[row-id="c"]') && !document.querySelector('[row-id="a"]') && !document.querySelector('[row-id="b"]'), '删除后仅剩未勾选片段');
      state.status.snapshot.segments = [
        { id: 'a', order: 1, text: '丙 第一段', video: null },
        { id: 'b', order: 2, text: '乙 第二段', video: null },
        { id: 'c', order: 3, text: '甲 第三段', video: null },
      ];
      const poll = () => action(() => [...intervals.values()].forEach(callback => callback()));
      await poll();
      await click('关闭查找');
      await select('b');
      await action(() => document.querySelector('[row-id="b"] [col-id="text"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
      check(document.querySelector('[aria-label="文案全文"]') && button('删除勾选').disabled && button('项目顺序上移').disabled && button('项目顺序下移').disabled, '真实文案编辑期间禁止批量操作');
      await action(() => window.browserInput({ key: 'Escape' })); await poll(); await select('b'); await click('查找');
      await select('a'); check(button('项目顺序上移').disabled && !button('项目顺序下移').disabled, '首段不能上移'); await select('a');
      await select('c'); check(!button('项目顺序上移').disabled && button('项目顺序下移').disabled, '末段不能下移'); await select('c');
      await action(() => document.querySelector('[col-id="order"] .ag-header-cell-label').click());
      await action(() => document.querySelector('[col-id="order"] .ag-header-cell-label').click());
      check(document.querySelector('[row-id="c"]').getAttribute('row-index') === '0', '显示按项目序号倒序');
      await select('b'); await filter('第二段');
      check(document.querySelector('[row-id="b"] [col-id="order"]').textContent.trim() === '2', '查找及排序不重编号');
      await click('项目顺序上移'); await poll();
      await action(() => window.browserInput({ click: '[aria-haspopup="menu"]' }));
      check(JSON.stringify(state.batchRequests.at(-1).changes[0]) === JSON.stringify({ kind: 'reorder', expectedIds: ['a','b','c'], ids: ['b','a','c'] }), '上移按实际项目顺序请求');
      check(button('项目顺序上移').disabled && !button('项目顺序下移').disabled, '移动到项目首段后更新边界');
      await click('项目顺序下移'); await poll();
      check(JSON.stringify(state.batchRequests.at(-1).changes[0].ids) === '["a","b","c"]', '下移按实际项目顺序请求');
      await filter('第一段'); check(scope().includes('已勾选 1 个片段'), '查找其他片段仍保留勾选');
      await click('项目顺序下移'); await poll();
      check(JSON.stringify(state.batchRequests.at(-1).changes[0].ids) === '["a","c","b"]', '查找后的单选仍按实际项目顺序移动');
      await action(() => window.browserInput({ click: '[aria-haspopup="menu"]' }));
      for (const lock of ['taskLocked', 'modification']) {
        state.status[lock] = lock === 'taskLocked' ? true : { owner: 'codex' }; await poll();
        check(button('删除勾选').disabled && button('项目顺序上移').disabled && button('项目顺序下移').disabled, '锁定保留禁用：' + lock);
        state.status[lock] = lock === 'taskLocked' ? false : null; await poll();
      }
      await filter(''); await select('b'); hidden();
      await select('a');
      await action(() => state.tableConnections.at(-1).resolve());
      hidden(); check(button('重新连接勾选') && document.querySelector('footer').textContent.includes('勾选连接已断开'), '无勾选仍显示断线及恢复入口');
      await click('重新连接勾选'); hidden();
      await select('a'); check(scope().includes('已勾选 1 个片段'), '重连后可重新勾选');
      state.selectionFailure = true; await select('c'); hidden();
      check(button('重新连接勾选'), '同步失败清空勾选但保留恢复入口');
      state.selectionFailure = false; await click('重新连接勾选');
      await select('a'); await select('a'); hidden();
      document.getElementById('result').dataset.state = 'passed';
    } catch (error) { document.getElementById('result').dataset.state = 'failed'; document.getElementById('result').textContent = error.stack; }
  })();
`;
for (const width of [1600, 420]) {
  test(`勾选操作显示、查找范围与项目顺序（${width}px）`, {
    skip: chrome ? false : '未执行：需要 Chrome/Chromium', timeout: 40000,
  }, t => checkInteractiveBrowser(t, script, fixture, width));
}
