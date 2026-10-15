import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chrome } from './helpers/browser.js';
import { relativeInsertFixture as insertFixture } from './helpers/relative-insert-fixture.js';
import { checkInteractiveBrowser } from './helpers/interactive-browser.js';
const script = String.raw`
import { act } from 'react'; import { createRoot } from 'react-dom/client'; import { App } from './src/panel/app.tsx'; import { state } from 'editing-fixture';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const timers=new Map();let timer=0;window.setInterval=cb=>{timers.set(++timer,cb);return timer};window.clearInterval=id=>timers.delete(id);
const action=async cb=>{await act(async()=>{await cb();await new Promise(r=>setTimeout(r,100));});await new Promise(r=>setTimeout(r,250));};
const input=request=>action(()=>window.browserInput(request)); const check=(v,m)=>{if(!v)throw Error(m)};
const right=id=>input({click:'[row-id="'+id+'"] [col-id="text"]',button:'right'});
const item=name=>[...menu().querySelectorAll('[role="menuitem"]')].find(node=>node.textContent===name);
const menu=()=>document.querySelector('[aria-label="口播片段操作"]');
(async()=>{try{
state.status.snapshot.segments=['a','b','c'].map((id,i)=>({id,order:i+1,text:id,video:null}));
await action(()=>createRoot(document.getElementById('root')).render(<App/>));
await right('a');
check(menu().textContent.includes('上方添加')&&menu().textContent.includes('下方添加'),'行菜单有两个插入入口');
await window.browserInput({screenshot:'relative-insert-menu'});
await input({click:'[role="menuitem"]:nth-child(2)'});
check(document.activeElement.getAttribute('aria-label')==='文案全文','插入后直接编辑文案');
check(state.selectionRequests.at(-1).join()==='new-0','仅选择新片段并同步当前对话');
const editor=document.activeElement.getBoundingClientRect();check(editor.left>=0&&editor.right<=innerWidth,'窄视口编辑器可用');
await window.browserInput({screenshot:'relative-insert-edit'});
await input({key:'X'});await input({key:'Enter'});
check(state.segmentRequests.at(-1).change.id==='new-0'&&state.segmentRequests.at(-1).change.text==='X','输入保存到新片段');
await action(()=>[...timers.values()].forEach(cb=>cb()));
await right('c');await input({key:'End'});await input({key:'Enter'});
check(state.batchRequests.at(-1).changes[0].relative.placement==='after','键盘末项下方添加');
check(document.activeElement.getAttribute('aria-label')==='文案全文','下方添加后编辑');
await input({key:'Escape'});
await action(()=>[...timers.values()].forEach(cb=>cb()));
await input({click:'[row-id="a"] input[type="checkbox"]'});
await right('a');
check(item('上方添加').getAttribute('aria-disabled')==='true' && item('下方添加').getAttribute('aria-disabled')==='true','多选保留禁用插入项');
await window.browserInput({screenshot:'relative-insert-disabled'});
await input({key:'Escape'});
await right('b');
state.status.taskLocked=true;await action(()=>[...timers.values()].forEach(cb=>cb()));
check(item('上方添加').getAttribute('aria-disabled')==='true','菜单打开后出现锁禁用');
await input({click:'[role="menuitem"]:nth-child(2)'});check(state.batchRequests.length===2,'禁用时无插入请求');
document.getElementById('result').dataset.state='passed';
}catch(e){document.getElementById('result').dataset.state='failed';document.getElementById('result').textContent=e.stack}})();
`;
for(const width of [1600,420])test('相对添加的真实右键键盘、勾选与文案保存（'+width+'px）',{skip:chrome?false:'需要 Chrome',timeout:40000},t=>checkInteractiveBrowser(t,script,insertFixture,width));

const interruptions = {
  search: `await action(() => button('查找').click()); await input({ key: 'b' });`,
  blank: `await input({ pointer: { type: 'mousePressed', x: 5, y: 5 } }); await input({ pointer: { type: 'mouseReleased', x: 5, y: 5 } });`,
  tab: `await input({ key: 'Tab' });`,
  arrow: `document.querySelector('[row-id="c"] [col-id="order"]').focus(); await input({ key: 'ArrowDown' });`,
  control: `document.querySelector('[row-id="c"] [col-id="1"]').focus(); await input({ key: 'Tab' }); check(document.activeElement.hasAttribute('data-speech-more'), '真实Tab进入只读配音更多按钮');`,
  edge: `document.querySelector('[row-id="tail-5"] [col-id="order"]').focus(); await input({ key: 'ArrowDown' });`,
  details: `await input({ click: '[row-id="c"] [data-row-details]' });`,
  wheel: `await input({ pointer: { type: 'mouseWheel', x: 500, y: 450, deltaY: 600 } });`,
  more: `await input({ click: 'header button:last-child' });`,
  leave: `await action(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });`,
};
const lateInsert = (stage: 'request' | 'edit', interruption: keyof typeof interruptions = 'search') => String.raw`
import { act } from 'react'; import { createRoot } from 'react-dom/client'; import { App } from './src/panel/app.tsx'; import { state, deferred } from 'editing-fixture';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const timers = new Map(); let timer = 0; window.setInterval = callback => { timers.set(++timer, callback); return timer; }; window.clearInterval = id => timers.delete(id);
const settle = () => new Promise(resolve => setTimeout(resolve, 80));
const check = (value, message) => { if (!value) throw Error(message); };
const action = async callback => { await act(async () => { await callback(); await settle(); }); await settle(); };
const button = label => [...document.querySelectorAll('button')].find(node => node.textContent === label);
const input = request => action(() => window.browserInput(request));
(async () => { try {
  state.status.snapshot.segments = ['a', 'b', 'c', ...Array.from({ length: 77 }, (_, index) => 'tail-' + index)].map((id, index) => ({ id, order: index + 1, text: id, visualNote: '', video: null }));
  await action(() => createRoot(document.getElementById('root')).render(<App />));
  await input({ click: '[row-id="b"] [col-id="text"]', button: 'right' });
  state.saveGate = deferred(); const saveGate = state.saveGate;
  await input({ click: '[role="menuitem"]:nth-child(3)' });
  check(state.batchRequests?.length === 1 && !document.querySelector('[aria-label="文案全文"]'), '真实新增请求已进入等待，未提前编辑');
  if ('${stage}' === 'edit') {
    state.acquireGate = deferred(); state.saveGate = null;
    await action(() => saveGate.resolve());
    check(state.leases.length === 2 && !document.querySelector('[aria-label="文案全文"]'), '新增完成后第二次修改权响应仍等待');
  }
  ${interruptions[interruption]}
  const currentFocus = document.activeElement;
  const focusedRow = currentFocus.closest('[row-id]')?.getAttribute('row-id'); const focusedColumn = currentFocus.getAttribute('col-id');
  const search = document.querySelector('[aria-label="查找文案"]');
  const layers = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')];
  const selection = JSON.stringify(state.selectionRequests.at(-1));
  const vertical = document.querySelector('.ag-body-vertical-scroll-viewport'); const scroll = vertical.scrollTop;
  await action(() => {
    if ('${stage}' === 'edit') { const gate = state.acquireGate; state.acquireGate = null; gate.resolve(); }
    else { state.saveGate = null; saveGate.resolve(); }
  });
  if (['arrow', 'control'].includes('${interruption}')) await new Promise(resolve => setTimeout(resolve, 350));
  check(state.status.snapshot.segments.slice(0, 4).map(segment => segment.id).join() === 'a,b,new-0,c', '合法新增数据仍在锚点下方接收');
  check(document.querySelector('[data-save-status]').textContent === '已保存', '迟到成功仍接收成功状态');
  check((focusedRow ? document.activeElement.closest('[row-id]')?.getAttribute('row-id') === focusedRow && document.activeElement.getAttribute('col-id') === focusedColumn : document.activeElement === currentFocus) && !document.querySelector('[aria-label="文案全文"]'), '迟到结果保留新焦点，不进入旧新增编辑：' + JSON.stringify({expectedRow:focusedRow,actualRow:document.activeElement.closest('[row-id]')?.getAttribute('row-id'),expectedColumn:focusedColumn,actualColumn:document.activeElement.getAttribute('col-id')}));
  if ('${interruption}' === 'control') check(document.activeElement === currentFocus, '迟到更新保留同一个仍存续的只读按钮');
  if (search) check(search.value === 'b' && document.querySelector('[aria-label="查找文案"]') === search, '查找条件和面板持续保留');
  check(layers.every(layer => layer.isConnected && layer.contains(document.activeElement)), '新打开的最上层持续拥有焦点');
  check(JSON.stringify(state.selectionRequests.at(-1)) === selection && vertical.scrollTop === scroll, '迟到结果不改变当前勾选或滚动');
  if ('${stage}' === 'edit') check(state.leases[1].closes === 1 && !state.current, '转向后迟到的第二次修改权立即释放');
  await action(() => { vertical.scrollTop = 0; });
  check(document.querySelector('[row-id="new-0"]'), '用户主动返回表格后仍能看到真实新增行');
  document.getElementById('result').dataset.state = 'passed';
} catch(error) { document.getElementById('result').dataset.state = 'failed'; document.getElementById('result').textContent = error.stack; } })();
`;
test('相对添加请求等待期间转向查找后仍接收数据且不抢焦点', { timeout: 40000 }, t => {
  assert.ok(chrome, '必须实际运行 Chrome');
  return checkInteractiveBrowser(t, lateInsert('request'), insertFixture, 1600, 1000);
});
test('相对添加后第二次修改权等待期间转向查找不抢焦点且释放租约', { timeout: 40000 }, t => {
  assert.ok(chrome, '必须实际运行 Chrome');
  return checkInteractiveBrowser(t, lateInsert('edit'), insertFixture, 1600, 1000);
});

for (const stage of ['request', 'edit'] as const) for (const interruption of ['blank', 'tab', 'arrow', 'control', 'edge', 'details', 'wheel', 'more', 'leave'] as const) {
  test('相对添加迟到矩阵：' + stage + '/' + interruption, { timeout: 40000 }, t => {
    assert.ok(chrome, '必须实际运行 Chrome');
    return checkInteractiveBrowser(t, lateInsert(stage, interruption), insertFixture, 1600, 1000);
  });
}
