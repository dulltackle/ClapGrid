import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome } from './helpers/browser.js';
import { checkInteractiveBrowser } from './helpers/interactive-browser.js';

const script = String.raw`
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DeleteConfirm } from './src/panel/delete-confirm.tsx';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const action = async cb => { await act(async () => { await cb(); }); await new Promise(r => setTimeout(r, 100)); };
const root = createRoot(document.getElementById('root'));
const render = disabled => root.render(<DeleteConfirm count={1} disabled={disabled} lock="" onClose={()=>{}} onConfirm={()=>{}} restoreFocus={()=>{}}/>);
(async () => { try {
await action(()=>render(false));
await action(()=>window.browserInput({key:'Tab'}));
const confirm = document.querySelector('[data-delete-confirm]');
if (document.activeElement !== confirm) throw Error('禁用前必须聚焦删除按钮');
await action(()=>render(true));
if (document.activeElement.textContent !== '取消') throw Error('确认动态禁用后焦点移到可用取消：'+document.activeElement.tagName);
document.getElementById('result').dataset.state='passed';
} catch(e) { document.getElementById('result').dataset.state='failed'; document.getElementById('result').textContent=e.stack; }})();
`;

test('删除确认按钮动态禁用后焦点移到取消', { timeout: 15000 }, t => {
  assert.ok(chrome, '焦点回归需要真实 Chrome');
  return checkInteractiveBrowser(t, script, '');
});
