import { test } from 'node:test';
import { checkBrowser, chrome } from './helpers/browser.js';

import { fixture } from './helpers/editing-fixture.js';

test('真实编辑视图共享刷新仲裁，连续保存、断线取消草稿和单次保存正常关闭均符合约定', {
  skip: chrome ? false : '需要 Chrome/Chromium，可通过 CHROME_BIN 指定', timeout: 30000,
}, async t => checkBrowser(t, String.raw`
  import { act, StrictMode } from 'react';
  import { createRoot } from 'react-dom/client';
  import { App } from './src/panel/app.tsx';
  import { assertTheme } from './tests/helpers/theme-contract.ts';
  import { state, deferred } from 'editing-fixture';
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const intervals = new Map(); let nextTimer = 0;
  window.setInterval = callback => { const id = ++nextTimer; intervals.set(id, callback); return id; };
  window.clearInterval = id => intervals.delete(id);
  const root = createRoot(document.getElementById('root'));
  const result = document.getElementById('result');
  const check = (value, message) => { if (!value) throw Error(message); };
  const settle = () => new Promise(resolve => setTimeout(resolve, 30));
  const button = text => [...document.querySelectorAll('button')].find(node => node.textContent === text);
  const field = label => document.querySelector('[aria-label="' + label + '"]');
  const click = async text => { await act(async () => { const node = button(text); check(node && !node.disabled, '按钮不可用：' + text); node.click(); await settle(); }); };
  const input = async (node, value) => { await act(async () => {
    Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  }); };
  const change = async (label, value) => { await act(async () => { const node = field(label); node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); }); };
  const poll = async () => { await act(async () => { [...intervals.values()].forEach(callback => callback()); await settle(); }); };
  (async () => {
    try {
      await act(async () => { root.render(<StrictMode><App /></StrictMode>); await settle(); });
      await poll();
      state.delayQuery = true; await poll();
      check(state.queries.length > 0, '必须先发出一条会迟到的项目查询');
      await click('更多'); await click('导出设置'); await click('编辑设置');
      assertTheme('form', field('导出编码'));
      assertTheme('form', field('字幕字号（px）'));
      const settingsLease = state.current;
      await change('导出帧率', '60');
      await change('导出编码', 'mpeg4');
      check(state.current === settingsLease && settingsLease.closes === 0, '设置连续保存应保持同一修改权');
      state.delayQuery = false;
      await act(async () => { state.queries.splice(0).forEach(item => item.gate.resolve()); });
      await click('关闭设置'); await click('更多'); await click('导出设置');
      check(field('导出帧率').value === '60' && field('导出编码').value === 'mpeg4', '旧查询不能覆盖设置保存后的父级快照');
      check(settingsLease.closes === 1, '关闭设置应释放修改权一次');
      await poll(); await click('编辑设置');
      await input(field('字幕字号（px）'), '99');
      await act(async () => { state.current.disconnect(); });
      check(field('字幕字号（px）').value === '32' && field('字幕字号（px）').disabled, '断线后取消尚未提交的字号');
      await click('关闭设置'); await poll();
      await act(async () => {
        const cell = document.querySelector('.ag-row[row-id="segment"] [col-id="text"]');
        check(cell, '应显示真实表格文案单元格');
        cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await settle();
      });
      const editor = field('文案全文');
      check(editor, '双击应打开真实文案编辑器');
      await input(editor, '已保存的新文案');
      state.saveGate = deferred();
      await act(async () => { editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle(); });
      check(document.querySelector('[data-save-status]').textContent.includes('保存中'), '连接先正常关闭时仍等待保存响应');
      await act(async () => { state.saveGate.resolve(); state.saveGate = null; await settle(); });
      check(document.querySelector('[data-save-status]').textContent === '已保存', '连接先关闭、保存后成功不能误报失败');
      check(document.querySelector('.ag-row[row-id="segment"] [col-id="text"]').textContent === '已保存的新文案', '表格应显示保存结果');
      await click('更多'); await click('导入本地视频');
      await input(field('视频文件绝对路径'), '/tmp/example.mp4');
      state.saveGate = deferred();
      await click('导入并复制');
      const oldSave = state.saveGate; state.saveGate = null;
      await click('取消'); await poll();
      await click('更多'); await click('导出设置'); await click('编辑设置');
      const newLease = state.current;
      await change('导出帧率', '24');
      await act(async () => { oldSave.resolve(); });
      check(state.current === newLease && newLease.closes === 0, '取消后的迟到保存不得释放新编辑');
      check(field('导出帧率').value === '24', '取消后的迟到保存不得覆盖新设置');
      await click('关闭设置'); await poll();
      state.statusFailure = true; await poll();
      check(document.body.textContent.includes('关闭重开 ClapGrid'), '连接失效时明确提示关闭重开和核对工作空间');
      check(button('新增口播片段').disabled && button('导出全片').disabled, '状态不可用时旧面板禁止新增及导出');
      state.statusFailure = false; await poll();
      state.acquireGate = deferred();
      await click('更多'); await click('导入本地视频');
      const lateLease = state.current;
      await act(async () => { window.dispatchEvent(new Event('pagehide')); state.acquireGate.resolve(); state.acquireGate = null; await settle(); });
      check(lateLease.closes === 1 && !field('视频文件绝对路径'), '离页后迟到的修改权必须释放且不打开编辑器');
      await act(async () => { window.dispatchEvent(new Event('pageshow')); await settle(); });
      await click('更多'); await click('导出设置'); await click('编辑设置');
      check(state.current, '返回页面后仍可重新编辑');
      const unmountedLease = state.current;
      await act(async () => { root.unmount(); });
      check(unmountedLease.closes === 1, '卸载时释放修改权');
      result.dataset.state = 'passed'; result.textContent = '全部编辑时序验证通过';
    } catch (error) { result.dataset.state = 'failed'; result.textContent = error.stack + '\n界面：' + document.getElementById('root').innerText; }
  })();
`, fixture));
