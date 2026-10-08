import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome } from './helpers/browser.js';
import { fixture } from './helpers/editing-fixture.js';
import { checkInteractiveBrowser } from './helpers/interactive-browser.js';

for (const [width, height] of [[1600, 1000], [420, 800], [420, 360]]) test(`声音设置的原生键盘与提交互斥（${width}×${height}）`, { timeout: 40000 }, t => {
  assert.ok(chrome, '验收必须实际运行 Chrome');
  return checkInteractiveBrowser(t, String.raw`
    import { act } from 'react';
    import { createRoot } from 'react-dom/client';
    import { App } from './src/panel/app.tsx';
    import { assertTheme, assertKeyboardFocus } from './tests/helpers/theme-contract.ts';
    import { state, deferred } from 'editing-fixture';
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const intervals = new Map(); let timer = 0;
    window.setInterval = callback => { intervals.set(++timer, callback); return timer; };
    window.clearInterval = id => intervals.delete(id);
    const check = (value, message) => { if (!value) throw Error(message); };
    const settle = () => new Promise(resolve => setTimeout(resolve, 70));
    const button = text => [...document.querySelectorAll('button')].find(node => node.textContent === text);
    const click = async text => { await act(async () => { const node = button(text); check(node && !node.disabled, '入口可用：' + text); node.focus(); node.click(); await settle(); }); await settle(); };
    const key = async (key, shift = false) => { await act(async () => { await window.browserInput({ key, shift }); await settle(); }); await settle(); };
    const poll = async () => { await act(async () => { [...intervals.values()].forEach(callback => callback()); await settle(); }); };
    const dialog = () => document.querySelector('[role="dialog"][aria-modal="true"]');
    const field = name => document.querySelector('[aria-label="' + name + '"]');
    const change = async (name, value) => { await act(async () => { const node = field(name); node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); await settle(); }); };
    (async () => { try {
      state.speech = { locked: false, configured: true, configPath: '/tmp/' + '很长的配置路径'.repeat(30), voice: { speaker: 'zh_female_vv_uranus_bigtts', speechRate: 0 }, audio: [], tasks: [], operations: [] };
      await act(async () => { createRoot(document.getElementById('root')).render(<App />); await settle(); }); await settle();
      await click('更多'); await click('声音设置');
      check(dialog() && document.getElementById(dialog().getAttribute('aria-labelledby'))?.textContent === '统一声音设置', '统一弹窗以可见标题命名');
      check(document.getElementById(dialog().getAttribute('aria-describedby'))?.textContent.includes('已配置不代表服务已验证'), '说明与弹窗关联');
      check(document.activeElement === dialog(), '面板交接后容器拥有焦点');
      assertTheme('dialog', dialog()); assertTheme('form', field('统一音色')); assertTheme('form', field('统一语速')); assertTheme('cancel', button('关闭声音设置'));
      check(field('统一语速') instanceof HTMLSelectElement && field('统一语速').options.length === 151 && field('统一语速').options[0].value === '-50' && field('统一语速').options[150].value === '100', '保留 151 个原生语速选项及边界');
      check([...field('统一音色').options].map(n => n.textContent).join(',') === 'vivi 2.0,流畅女声,儒雅逸辰', '保留全部原生音色');
      await key('Tab'); assertKeyboardFocus(field('统一音色'));
      await key('ArrowDown'); check(field('统一音色').value === 'zh_female_santongyongns_saturn_bigtts', '原生方向键选择并保存音色');
      field('统一音色').focus(); await key('Tab'); assertKeyboardFocus(field('统一语速'));
      await key('ArrowDown'); check(field('统一语速').value === '1' && dialog().textContent.includes('1.01 倍'), '原生方向键选择并保存语速');
      field('统一语速').focus(); await key('Tab'); check(document.activeElement === button('关闭声音设置'), 'Tab 到关闭');
      await key('Tab'); check(document.activeElement === field('统一音色'), 'Tab 环绕');
      await key('Tab', true); check(document.activeElement === button('关闭声音设置'), 'Shift+Tab 环绕');
      const r = dialog().getBoundingClientRect(); check(r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && dialog().scrollWidth <= dialog().clientWidth, '长说明在视口内滚动且无横向溢出');
      button('关闭声音设置').scrollIntoView({ block: 'nearest' }); check(button('关闭声音设置').getBoundingClientRect().bottom <= innerHeight, '窄矮视口关闭可达');
      await window.browserInput({ screenshot: 'voice-' + innerHeight });
      await window.browserInput({ pointer: { type: 'mousePressed', x: 2, y: 2 } }); await window.browserInput({ pointer: { type: 'mouseReleased', x: 2, y: 2 } }); await settle(); check(dialog(), '遮罩不关闭');
      for (const lock of ['task', 'speech', 'user', 'codex']) {
        field('统一音色').focus();
        state.status.taskLocked = lock === 'task'; state.speech.locked = lock === 'speech'; state.status.modification = ['user', 'codex'].includes(lock) ? { owner: lock } : null; await poll();
        check(field('统一音色').disabled && field('统一语速').disabled && !button('关闭声音设置').disabled, '任务及编辑占用禁止修改但允许退出：' + lock);
        check(document.activeElement === dialog(), '动态禁用以容器承接焦点'); await settle(); assertTheme('disabled', field('统一音色'));
        state.status.taskLocked = false; state.speech.locked = false; state.status.modification = null; await poll();
      }
      state.voiceFailure = true; await change('统一语速', '20');
      check(dialog().querySelector('[role="alert"]')?.textContent.includes('声音保存失败') && field('统一语速').value === '1', '失败显示可访问错误并保留原值');
      await key('Escape'); check(!dialog() && document.activeElement === button('更多'), '失败后允许退出并返回更多');
      await click('更多'); await click('声音设置'); state.voiceFailure = false; state.saveGate = deferred();
      field('统一语速').focus(); await change('统一语速', '20');
      check(field('统一音色').disabled && field('统一语速').disabled && button('关闭声音设置').disabled && document.activeElement === dialog(), '提交中全部禁用且焦点有后备');
      await key('Escape'); check(dialog(), '提交中 Escape 不关闭');
      await act(async () => { button('关闭声音设置').click(); await settle(); }); check(dialog(), '提交中按钮不能关闭');
      await act(async () => { state.saveGate.resolve(); state.saveGate = null; await settle(); });
      check(field('统一语速').value === '20' && !dialog().querySelector('[role="alert"]') && !button('关闭声音设置').disabled, '成功后可见新值并清除错误');
      await click('关闭声音设置'); check(!dialog() && document.activeElement === button('更多') && !state.current, '保存结束无残留编辑占用并返回更多');
      document.getElementById('result').dataset.state = 'passed';
    } catch (error) { document.getElementById('result').dataset.state = 'failed'; document.getElementById('result').textContent = error.stack; } })();
  `, fixture, width, height);
});

test('声音加载期间入口禁用，加载后保留未配置说明', { timeout: 40000 }, t => {
  assert.ok(chrome, '验收必须实际运行 Chrome');
  return checkInteractiveBrowser(t, String.raw`
    import { act } from 'react';
    import { createRoot } from 'react-dom/client';
    import { App } from './src/panel/app.tsx';
    import { state, deferred } from 'editing-fixture';
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const settle = () => new Promise(resolve => setTimeout(resolve, 70));
    const check = (value, message) => { if (!value) throw Error(message); };
    const button = text => [...document.querySelectorAll('button')].find(node => node.textContent === text);
    (async () => { try {
      state.speechLoadGate = deferred();
      await act(async () => { createRoot(document.getElementById('root')).render(<App />); await settle(); });
      await act(async () => { button('更多').click(); await settle(); });
      check(button('声音设置').disabled, '声音尚未加载不允许打开');
      await act(async () => { state.speechLoadGate.resolve(); state.speechLoadGate = null; await settle(); });
      check(!button('声音设置').disabled, '加载完成允许查看');
      await act(async () => { button('声音设置').click(); await settle(); });
      const dialog = document.querySelector('[role="dialog"]');
      check(dialog.textContent.includes('TokenDance 凭据：未配置') && dialog.textContent.includes('TOKENDANCE_KEY'), '未配置仍可查看设置与配置说明');
      document.getElementById('result').dataset.state = 'passed';
    } catch (error) { document.getElementById('result').dataset.state = 'failed'; document.getElementById('result').textContent = error.stack; } })();
  `, fixture.replace('export async function querySpeech() {', 'export async function querySpeech() { if (state.speechLoadGate) await state.speechLoadGate.promise;'));
});
