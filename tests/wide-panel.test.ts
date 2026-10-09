import { test } from 'node:test';
import { fixture } from './helpers/editing-fixture.js';
import { checkInteractiveBrowser } from './helpers/interactive-browser.js';

const script = String.raw`
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './src/panel/app.tsx';
import { state } from 'editing-fixture';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const settle = () => new Promise(resolve => setTimeout(resolve, 100));
const check = (value, message) => { if (!value) throw Error(message); };
const click = async selector => { await act(async () => { await window.browserInput({ click: selector }); await settle(); }); await settle(); };
const key = async key => { await act(async () => { await window.browserInput({ key }); await settle(); }); };
const cell = () => document.querySelector('[row-id="segment"] [col-id="text"]');
(async () => { try {
 state.status.snapshot.segments.push({ id: 'second', order: 2, text: '第二条文案', video: null });
 await act(async () => { createRoot(document.getElementById('root')).render(<App />); await settle(); }); await settle();
 check(!document.querySelector('[aria-label="口播片段详情"]'), '默认没有片段详情');
 check(cell().getBoundingClientRect().width >= (innerWidth > 1000 ? 700 : 330), '文案获得主要剩余宽度');
 const before = cell().getBoundingClientRect().toJSON();
 await click('[row-id="segment"] [col-id="text"]');
 const editor = document.querySelector('[aria-label="文案全文"]');
 check(editor && document.activeElement === editor, '单击直接编辑');
 check(editor.getBoundingClientRect().height <= before.height, '行内编辑不增高');
 check(!document.body.textContent.includes('Shift+Enter 换行'), '没有底部快捷键提示');
 await key('Escape');
 await click('[aria-label="查看片段 1 的详情"]');
 check(document.querySelector('[aria-label="口播片段详情"]'), '行尾打开非模态详情');
 const after = cell().getBoundingClientRect();
 check(before.x === after.x && before.width === after.width && before.height === after.height, '详情不改变列宽和行高');
 await click('[row-id="second"] [col-id="text"]');
 check(document.querySelector('[aria-label="文案全文"]') === document.activeElement, '详情联动不抢编辑焦点');
 check(document.querySelector('[aria-label="口播片段详情"]').textContent.includes('片段 2'), '详情跟随稳定身份');
 await key('Escape');
 await settle(); check(!document.querySelector('[aria-label="文案全文"]'), 'Escape 结束编辑'); check(!document.querySelector('[aria-label="详情文案"]').disabled, '详情可编辑：'+JSON.stringify({lease:!!state.current, footer:document.querySelector('footer').textContent}));
 await click('[aria-label="详情文案"]');
 const draft = document.querySelector('[aria-label="详情文案"]');
 await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(draft, '详情草稿'); draft.dispatchEvent(new Event('input', { bubbles: true })); });
 await act(async () => { await window.browserInput({ pointer: { type: 'mousePressed', x: cell().getBoundingClientRect().left + 20, y: cell().getBoundingClientRect().top + 20 } }); await window.browserInput({ pointer: { type: 'mouseReleased', x: cell().getBoundingClientRect().left + 20, y: cell().getBoundingClientRect().top + 20 } }); await settle(); });
 check(document.querySelector('[role="alertdialog"]'), '切换前确认未保存草稿：' + JSON.stringify({value:draft.value, disabled:draft.disabled, readonly:draft.readOnly, lease:!!state.current, body:document.querySelector('aside')?.textContent, editor:!!document.querySelector('[aria-label="文案全文"]')} ));
 await click('[data-continue-editing]');
 check(document.querySelector('[aria-label="详情文案"]').value === '详情草稿', '继续编辑保留草稿');
 await act(async () => { await window.browserInput({ pointer: { type: 'mousePressed', x: cell().getBoundingClientRect().left + 20, y: cell().getBoundingClientRect().top + 20 } }); await window.browserInput({ pointer: { type: 'mouseReleased', x: cell().getBoundingClientRect().left + 20, y: cell().getBoundingClientRect().top + 20 } }); await settle(); });
 await click('[data-discard-draft]');
 check(document.activeElement === document.querySelector('[aria-label="文案全文"]'), '放弃后按原意图进入目标行编辑');
 await key('Escape');
 document.getElementById('result').dataset.state = 'passed';
} catch(error) { document.getElementById('result').dataset.state = 'failed'; document.getElementById('result').textContent = error.stack; } })();
`;
for (const [width, height] of [[1200, 800], [780, 579]]) {
  test(`宽面板文案优先与详情联动（${width}）`, { timeout: 40000 }, t => checkInteractiveBrowser(t, script, fixture, width, height));
}
