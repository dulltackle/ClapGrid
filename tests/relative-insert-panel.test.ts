import { test } from 'node:test';
import { chrome } from './helpers/browser.js';
import { fixture } from './helpers/editing-fixture.js';
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
const insertFixture=fixture.replace("if (change.id) state.status.snapshot.segments[0].text = change.text;","if (change.id) state.status.snapshot.segments.find(s => s.id === change.id).text = change.text;")
.replace("for (const change of batch.changes) {", "for (const change of batch.changes) { if(change.kind==='add'){const id='new-'+(state.batchRequests.length-1);const list=state.status.snapshot.segments;list.splice(list.findIndex(s=>s.id===change.relative.anchor.id)+(change.relative.placement==='after'?1:0),0,{id,order:0,text:change.text,video:null});}")
.replace("results: [] };", "results: [{index:0,id:'new-'+(state.batchRequests.length-1),outcome:'applied',message:'已完成'}] };");
for(const width of [1600,420])test('相对添加的真实右键键盘、勾选与文案保存（'+width+'px）',{skip:chrome?false:'需要 Chrome',timeout:40000},t=>checkInteractiveBrowser(t,script,insertFixture,width));
