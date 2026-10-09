import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome } from './helpers/browser.js';
import { fixture } from './helpers/editing-fixture.js';
import { checkInteractiveBrowser } from './helpers/interactive-browser.js';

for (const [width, height] of [[1600, 1000], [420, 800], [420, 360]]) test(`页头和状态栏紧凑主题、键盘与任务锁（${width}×${height}）`, { timeout: 40000 }, async t => {
  assert.ok(chrome, '需要实际 Chrome，浏览器缺失不能视为通过');
  await checkInteractiveBrowser(t, String.raw`
    import { act } from 'react';
    import { createRoot } from 'react-dom/client';
    import { App } from './src/panel/app.tsx';
    import { state } from 'editing-fixture';
    import { assertTheme, assertKeyboardFocus } from './tests/helpers/theme-contract.ts';
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const intervals = new Map(); let timer = 0;
    window.setInterval = callback => { intervals.set(++timer, callback); return timer; };
    window.clearInterval = id => intervals.delete(id);
    const check = (value, message) => { if (!value) throw Error(message); };
    const settle = () => new Promise(resolve => setTimeout(resolve, 180));
    const action = async callback => { await act(async () => { await callback(); await settle(); }); await settle(); };
    const button = text => [...document.querySelectorAll('button')].find(node => node.textContent === text);
    const poll = () => action(() => [...intervals.values()].forEach(callback => callback()));
    const visible = node => { const r = node.getBoundingClientRect(); check(r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, '操作完整可见：' + node.textContent); };
    (async () => { try {
      await action(() => createRoot(document.getElementById('root')).render(<App />));
      const header = document.querySelector('header');
      for (const node of header.querySelectorAll('button')) {
        visible(node); assertTheme('form', node);
        check(node.getBoundingClientRect().height === 32, '页头统一为紧凑 32px 操作高度');
      }
      await action(() => window.browserInput({ key: 'Tab' }));
      assertKeyboardFocus(button('新增口播片段'));
      const grid = document.querySelector('[role="grid"]').getBoundingClientRect();
      await action(() => button('查找').click());
      const input = document.querySelector('[aria-label="查找文案"]');
      visible(input); assertKeyboardFocus(input);
      check(document.activeElement === input, '打开查找聚焦输入');
      await action(() => window.browserInput({ key: 'Tab' }));
      assertKeyboardFocus(button('关闭查找'));
      check(button('上一个').disabled && button('下一个').disabled, '空查询禁用定位');
      assertTheme('disabled', button('下一个'));
      await action(() => window.browserInput({ key: 'Enter' }));
      check(!document.querySelector('[aria-label="查找文案"]'), '键盘关闭查找');
      state.status.taskLocked = true; state.exports.locked = true; await poll();
      await new Promise(resolve => setTimeout(resolve, 200));
      check(button('新增口播片段').disabled && button('导出全片').disabled, '任务锁保留新增和导出禁用');
      assertTheme('disabled', button('新增口播片段'));
      check(!button('查找').disabled && !button('更多').disabled, '任务锁下查看入口可用');
      check(document.querySelector('footer').textContent.includes('项目已锁定'), '任务锁状态可读');
      state.exportFailure = true; await poll();
      const errors = document.querySelector('[aria-label="操作异常"]');
      check(errors && errors.textContent.trim(), '连接错误持续可见');
      assertTheme('statusError', errors); visible(errors); visible(button('任务详情'));
      check(document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight, '页面无外部溢出');
      const after = document.querySelector('[role="grid"]').getBoundingClientRect();
      check(after.top === grid.top && after.height > 120, '错误状态仍保留表格可用空间');
      await window.browserInput({ screenshot: 'shell-locked-error-' + innerHeight });
      document.getElementById('result').dataset.state = 'passed';
    } catch (error) { document.getElementById('result').dataset.state = 'failed'; document.getElementById('result').textContent = error.stack; } })();
  `, fixture, width, height);
});
