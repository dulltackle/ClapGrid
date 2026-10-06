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
  const action = async callback => { await act(async () => { await callback(); await new Promise(r => setTimeout(r, 80)); }); await new Promise(r => setTimeout(r, 150)); };
  const input = request => action(() => window.browserInput(request));
  const count = () => document.querySelector('[aria-haspopup="menu"]');
  const search = () => document.querySelector('[aria-label="查找文案"]');
  const menu = () => document.querySelector('[role="menu"]');
  const geometry = () => { const r = document.querySelector('.grid').getBoundingClientRect(); return JSON.stringify([r.top, r.height]); };
  (async () => {
    try {
      state.status.snapshot.segments = [
        { id: 'a', order: 1, text: '第一段', video: null },
        { id: 'b', order: 2, text: '第二段', video: null },
      ];
      await action(() => createRoot(document.getElementById('root')).render(<App />));
      const baseline = geometry();
      const layout = () => {
        check(geometry() === baseline, '菜单所有状态保持表格顶部和高度：' + geometry() + '/' + baseline + '；' + document.querySelector('footer').textContent);
        check(document.documentElement.scrollWidth <= innerWidth, '无页面横向溢出');
        const gridTop = document.querySelector('.grid').getBoundingClientRect().top;
        for (const node of document.querySelectorAll('header button, header input')) {
          const r = node.getBoundingClientRect(); if (!r.width) continue;
          check(r.left >= 0 && r.right <= innerWidth && r.bottom <= gridTop, '每个入口均在页头且不遮挡表格');
          check(node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)), '入口真实命中区域未被遮挡');
        }
        check(search().getBoundingClientRect().width >= 72, '查找输入保留可用宽度');
      };
      await input({ click: '.search-trigger' }); layout();
      await input({ click: '[row-id="a"] input[type="checkbox"]' }); layout();
      check(document.querySelector('.search-popover [role="status"]').getBoundingClientRect().width >= 32, '有选择时保留可见匹配状态');
      check(count().textContent === '已选 1 项' && count().getAttribute('aria-expanded') === 'false', '单选数量与收起状态');
      await input({ click: '[aria-haspopup="menu"]' }); layout();
      await window.browserInput({ screenshot: 'selection-menu-open' });
      check(menu() && document.activeElement.getAttribute('aria-label') === '取消选择', '鼠标打开并聚焦菜单首项');
      await input({ key: 'End' }); check(document.activeElement.getAttribute('aria-label') === '项目顺序下移', 'End 导航至末项');
      state.status.taskLocked = true;
      await action(() => [...intervals.values()].forEach(callback => callback()));
      check(document.activeElement.getAttribute('aria-label') === '取消选择', '轮询锁定禁用当前菜单项时回到可用项');
      await input({ key: 'Escape' }); check(!menu() && document.activeElement === count(), '动态禁用后 Esc 仍可关闭菜单');
      state.status.taskLocked = false;
      await action(() => [...intervals.values()].forEach(callback => callback()));
      await input({ key: 'Enter' }); await input({ key: 'End' });
      await input({ key: 'ArrowLeft' }); check(document.activeElement.getAttribute('aria-label') === '删除勾选', '方向键跳过禁用上移');
      await input({ key: 'Escape' }); layout();
      check(!menu() && search() && document.activeElement === count() && count().getAttribute('aria-expanded') === 'false', 'Esc 仅收起菜单并回入口');
      await input({ key: 'Enter' }); layout();
      await input({ key: 'End' }); await input({ key: 'Enter' });
      check(!menu() && document.activeElement === count(), '键盘移动到边界后关闭菜单并返回有效入口');
      await action(() => [...intervals.values()].forEach(callback => callback()));
      await input({ key: 'Enter' });
      await input({ key: 'Tab' }); check(!menu() && document.activeElement.getAttribute('aria-haspopup') === 'dialog', 'Tab 离开菜单到更多');
      await input({ click: '[row-id="b"] input[type="checkbox"]' }); layout();
      check(count().textContent === '已选 2 项', '最终多选数量');
      await input({ click: 'header [aria-haspopup="dialog"]' });
      await input({ key: 'Tab' });
      check(document.activeElement.textContent === '新增口播片段' && !document.activeElement.disabled, '查找选择期间更多保留新增');
      await input({ key: 'Tab' }); await input({ key: 'Enter' });
      check(state.exportRequests.length === 1 && state.exportRequests[0].length === 1 && count().textContent === '已选 2 项' && search(), '查找选择期间键盘导出仍使用全片且保留上下文');
      await input({ click: '[aria-haspopup="menu"]' }); layout();
      check(!menu().querySelector('[aria-label="项目顺序上移"]'), '多选不提供移动');
      await input({ key: 'Enter' }); layout();
      check(!count() && !menu() && document.activeElement === search(), '键盘取消选择后入口消失并回查找');
      await input({ key: 'x' }); check(search().value === 'x', '取消后查找仍能输入');
      await input({ click: '[row-id="a"] input[type="checkbox"]' });
      await input({ click: '[aria-haspopup="menu"]' });
      await action(() => state.tableConnections.at(-1).resolve());
      check(!count() && !menu() && document.activeElement === search(), '断线清空选择和菜单并恢复有效焦点');
      await input({ click: 'footer [role="alert"] button' });
      check(!count(), '重连不恢复失效选择');
      await input({ click: '[row-id="a"] input[type="checkbox"]' });
      await input({ click: '[aria-haspopup="menu"]' });
      state.status.snapshot.segments = state.status.snapshot.segments.filter(s => s.id !== 'a');
      await action(() => [...intervals.values()].forEach(callback => callback())); layout();
      check(!count() && !menu() && document.activeElement === search(), '服务状态删除所选项后焦点有效');
      await input({ click: '[row-id="b"] input[type="checkbox"]' });
      await input({ click: '[aria-label="查找文案"]' });
      await input({ key: 'Escape' });
      check(!search() && document.querySelector('[aria-label="取消选择"]') && state.selectionRequests.at(-1)[0] === 'b', '查找 Esc 保留选择并恢复完整工具栏');
      check(geometry() === baseline, '关闭查找不移动表格');
      document.getElementById('result').dataset.state = 'passed';
    } catch (error) { document.getElementById('result').dataset.state = 'failed'; document.getElementById('result').textContent = error.stack; }
  })();
`;
for (const width of [1600, 420]) {
  test(`查找选择菜单真实输入、焦点与原位布局（${width}px）`, {
    skip: chrome ? false : '未执行：需要 Chrome/Chromium', timeout: 40000,
  }, t => checkInteractiveBrowser(t, script, fixture, width));
}
