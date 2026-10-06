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
  const action = async callback => { await act(async () => { await callback(); await new Promise(r => setTimeout(r, 100)); }); await new Promise(r => setTimeout(r, 220)); };
  const input = options => action(() => window.browserInput(options));
  const row = id => '[row-id="' + id + '"] [col-id="text"]';
  const selected = ids => {
    const actual = [...document.querySelectorAll('.ag-row[aria-selected="true"]')].map(node => node.getAttribute('row-id')).sort();
    check(JSON.stringify(actual) === JSON.stringify(ids), '可见选择应为 ' + ids + '，实际 ' + actual);
    check(JSON.stringify([...(state.selectionRequests.at(-1) ?? [])].sort()) === JSON.stringify(ids), '服务边界同步选择 ' + ids);
  };
  (async () => {
    try {
      state.status.snapshot.segments = [
        { id: 'a', order: 1, text: '丙 第一段', video: null },
        { id: 'b', order: 2, text: '乙 第二段', video: null },
        { id: 'c', order: 3, text: '甲 第三段', video: null },
      ];
      state.speech = { locked: false, voice: { speaker: 'zh_female_vv_uranus_bigtts', speechRate: 0 }, configured: true, configPath: '/tmp/config', operations: [], tasks: [],
        audio: [{ segmentId: 'b', taskId: 'audio-b', valid: true, url: '/test-audio.wav', createdAt: '2026-10-03T00:00:00Z', input: { text: '乙 第二段' } }] };
      await action(() => createRoot(document.getElementById('root')).render(<App />));
      await input({ click: row('a') }); selected(['a']);
      await window.browserInput({ screenshot: 'row-selection' });
      await input({ click: row('b') }); selected(['b']);
      await input({ click: row('a'), ctrl: true }); selected(['a','b']);
      await input({ click: row('b'), ctrl: true }); selected(['a']);
      await input({ click: row('c'), meta: true }); selected(['a','c']);
      await input({ click: row('a') });
      await input({ click: row('c'), shift: true }); selected(['a','b','c']);
      await input({ click: row('a') }); selected(['a']);
      await input({ click: '[aria-label="查看片段 2 的画面素材详情"]' }); selected(['a']);
      check(document.querySelector('dialog[open]'), '详情已打开');
      await input({ key: 'Escape' }); selected(['a']);
      await input({ click: '[row-id="b"] .speech-actions button:nth-child(2)' }); selected(['a']);
      check(document.querySelector('dialog[aria-label="配音试听"][open]'), '未选中片段的试听正常打开');
      await input({ key: 'Escape' }); selected(['a']);
      check(!document.querySelector('dialog[open]'), 'Esc 关闭试听并保留选择');
      await input({ click: '[aria-label="展开片段 2 的保留音频"]' }); selected(['a']);
      check(document.querySelector('dialog[aria-label="保留音频"][open]'), '未选中片段的配音详情正常打开');
      await input({ key: 'Escape' }); selected(['a']);
      check(!document.querySelector('dialog[open]'), 'Esc 关闭配音详情并保留选择');
      await input({ click: '[row-id="b"] .speech-state' }); selected(['b']);
      await input({ click: row('b'), key: 'double' });
      check(document.querySelector('[aria-label="文案全文"]'), '双击经修改权仲裁进入全文编辑');
      await input({ key: 'Escape' }); selected(['b']);
      check(!document.querySelector('[aria-label="文案全文"]'), 'Esc 关闭全文编辑');
      await input({ key: 'Escape' }); selected([]);
      await input({ key: 'Escape' }); selected([]);
      await input({ click: '[row-id="a"] input[type="checkbox"]' }); selected(['a']);
      check(document.querySelector('.ag-header input[type="checkbox"]').indeterminate, '部分选择时表头半选');
      await input({ key: 'Escape' }); selected([]);
      await input({ click: '[row-id="a"] input[type="checkbox"]' });
      await input({ click: '[row-id="c"] input[type="checkbox"]' }); selected(['a','c']);
      await input({ click: '.ag-header input[type="checkbox"]' }); selected(['a','b','c']);
      await input({ click: '.ag-header input[type="checkbox"]' }); selected([]);
      await input({ click: '[col-id="order"] .ag-header-cell-label' });
      await input({ click: '[col-id="order"] .ag-header-cell-label' });
      check(document.querySelector('[row-id="c"]').getAttribute('row-index') === '0', '按显示顺序倒排');
      await input({ click: row('c') }); await input({ click: row('b'), shift: true }); selected(['b','c']);
      await action(() => [...intervals.values()].forEach(callback => callback())); selected(['b','c']);
      state.status.snapshot.segments = state.status.snapshot.segments.filter(segment => segment.id !== 'c');
      await action(() => [...intervals.values()].forEach(callback => callback()));
      await new Promise(r => setTimeout(r, 500)); selected(['b']);
      await input({ click: 'header' }); selected(['b']);
      await input({ click: 'header [aria-haspopup="dialog"]' });
      for (let index = 0; index < 3; index++) await input({ key: 'Tab' });
      check(document.activeElement.textContent === '查找', '选择期间从更多访问查找');
      await input({ key: 'Enter' });
      await input({ click: '[aria-label="查找文案"]' });
      await input({ key: 'Escape' }); selected(['b']);
      await input({ click: row('b') });
      await input({ key: 'ArrowDown' }); selected(['b']);
      check(document.activeElement.closest('[row-id="a"]'), '普通方向键移动单元格焦点');
      await input({ key: 'F2' });
      check(document.querySelector('[aria-label="文案全文"]'), 'F2 进入全文编辑');
      await input({ key: 'Escape' }); selected(['b']);
      await input({ key: 'Enter' });
      check(document.querySelector('[aria-label="文案全文"]'), 'Enter 进入全文编辑');
      await input({ key: 'Escape' }); selected(['b']);
      await action(() => state.tableConnections.at(-1).resolve());
      check(!document.querySelector('.ag-row[aria-selected="true"]'), '断线清空可见选择');
      check(document.querySelector('footer').textContent.includes('勾选连接已断开'), '断线清空并提示');
      document.getElementById('result').dataset.state = 'passed';
    } catch (error) { document.getElementById('result').dataset.state = 'failed'; document.getElementById('result').textContent = error.stack; }
  })();
`;
test('口播片段真实鼠标选择与上下文边界', { skip: chrome ? false : '未执行：需要 Chrome/Chromium', timeout: 40000 }, t => checkInteractiveBrowser(t, script, fixture));
