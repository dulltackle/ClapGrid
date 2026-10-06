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
  const button = text => [...document.querySelectorAll('button')].find(node => node.textContent === text);
  const click = text => action(() => { const node = button(text); check(node && !node.disabled, '入口可用：' + text); node.click(); });
  const select = id => action(() => { const node = document.querySelector('[row-id="' + id + '"] input[type="checkbox"]'); check(node, '可见片段：' + id); node.click(); });
  const filter = value => action(() => { const node = document.querySelector('[aria-label="查找文案"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); });
  const scope = () => (document.querySelector('[aria-label="组织口播片段"]')?.textContent ?? '');
  const hidden = () => check(!button('删除勾选') && !button('项目顺序上移') && !button('项目顺序下移') && !scope().includes('已勾选'), '无勾选时收起数量及批量操作');
  (async () => {
    try {
      state.status.snapshot.segments = [
        { id: 'a', order: 1, text: '丙 第一段', video: null },
        { id: 'b', order: 2, text: '乙 第二段', video: null },
        { id: 'c', order: 3, text: '甲 第三段', video: null },
      ];
      await action(() => createRoot(document.getElementById('root')).render(<App />));
      hidden(); await click('查找'); check(document.querySelector('[aria-label="查找文案"]'), '查找入口可用');
      await window.browserInput({ screenshot: 'unselected' });
      await select('a'); check(scope().includes('已勾选 1 个片段'), '勾选后显示数量');
      await select('a'); hidden();
      await select('a'); await select('b');
      check(button('项目顺序上移').disabled && button('项目顺序下移').disabled, '多选不允许移动');
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
      await select('b');
      await action(() => document.querySelector('[row-id="b"] [col-id="text"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
      check(document.querySelector('[aria-label="文案全文"]') && button('删除勾选').disabled && button('项目顺序上移').disabled && button('项目顺序下移').disabled, '真实文案编辑期间禁止批量操作');
      await action(() => window.browserInput({ key: 'Escape' })); await poll(); await select('b');
      await select('a'); check(button('项目顺序上移').disabled && !button('项目顺序下移').disabled, '首段不能上移'); await select('a');
      await select('c'); check(!button('项目顺序上移').disabled && button('项目顺序下移').disabled, '末段不能下移'); await select('c');
      await action(() => document.querySelector('[col-id="order"] .ag-header-cell-label').click());
      await action(() => document.querySelector('[col-id="order"] .ag-header-cell-label').click());
      check(document.querySelector('[row-id="c"]').getAttribute('row-index') === '0', '显示按项目序号倒序');
      await select('b'); await filter('第二段');
      check(document.querySelector('[row-id="b"] [col-id="order"]').textContent.trim() === '2', '查找及排序不重编号');
      await click('项目顺序上移'); await poll();
      check(JSON.stringify(state.batchRequests.at(-1).changes[0]) === JSON.stringify({ kind: 'reorder', expectedIds: ['a','b','c'], ids: ['b','a','c'] }), '上移按实际项目顺序请求');
      check(button('项目顺序上移').disabled && !button('项目顺序下移').disabled, '移动到项目首段后更新边界');
      await click('项目顺序下移'); await poll();
      check(JSON.stringify(state.batchRequests.at(-1).changes[0].ids) === '["a","b","c"]', '下移按实际项目顺序请求');
      await filter('第一段'); check(scope().includes('已勾选 1 个片段'), '查找其他片段仍保留勾选');
      await click('项目顺序下移'); await poll();
      check(JSON.stringify(state.batchRequests.at(-1).changes[0].ids) === '["a","c","b"]', '查找后的单选仍按实际项目顺序移动');
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
