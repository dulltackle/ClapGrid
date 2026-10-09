import { test } from 'node:test';
import { chrome } from './helpers/browser.js';
import { fixture } from './helpers/editing-fixture.js';
import { checkInteractiveBrowser } from './helpers/interactive-browser.js';

const script=String.raw`
import { assertTheme } from './tests/helpers/theme-contract.ts';
import {act} from 'react';import {createRoot} from 'react-dom/client';import {App} from './src/panel/app.tsx';import {state} from 'editing-fixture';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const intervals=new Map();let timer=0;window.setInterval=fn=>{intervals.set(++timer,fn);return timer;};window.clearInterval=id=>intervals.delete(id);
const check=(ok,message)=>{if(!ok)throw Error(message);};
const action=async fn=>{await act(async()=>{await fn();await new Promise(r=>setTimeout(r,80));});await new Promise(r=>setTimeout(r,160));};
const input=options=>action(()=>window.browserInput(options));const poll=()=>action(()=>[...intervals.values()].forEach(fn=>fn()));
const search=()=>document.querySelector('[aria-label="查找文案"]');
const selected=ids=>check(JSON.stringify([...(state.selectionRequests.at(-1)??[])].sort())===JSON.stringify(ids),'选择保持 '+ids);
(async()=>{try{
 state.status.snapshot.segments=[{id:'a',order:1,text:'第一段',video:null},{id:'b',order:2,text:'第二段',video:null}];
 await action(()=>createRoot(document.getElementById('root')).render(<App/>));
 const geometry=()=>{const r=document.querySelector('.segment-grid').getBoundingClientRect();return JSON.stringify([r.top,r.height]);};const baseline=geometry();
 const layout=()=>{
  check(geometry()===baseline,'选择和查找不移动或压缩表格');check(!document.querySelector('header [aria-haspopup="menu"]')&&!document.querySelector('.organization'),'查找不再出现等效选择菜单');
  check(document.documentElement.scrollWidth<=innerWidth,'查找与勾选共存无横向溢出');
  for(const node of document.querySelectorAll('header button,header input')){const r=node.getBoundingClientRect();if(!r.width)continue;check(r.left>=0&&r.right<=innerWidth&&r.bottom<=(node.closest('.search-popover')?innerHeight:document.querySelector('.segment-grid').getBoundingClientRect().top),'页头与浮动查找控件位于可用视口');check(node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),'查找控件命中无遮挡');}
  check(search().getBoundingClientRect().width>=72,'查找保留可用宽度');
 };
 await input({click:'.search-trigger'});await input({key:'第'});layout();
 await input({click:'[row-id="a"] input[type="checkbox"]'});layout();selected(['a']);
 await input({click:'[row-id="b"] input[type="checkbox"]'});layout();selected(['a','b']);
 await window.browserInput({screenshot:'search-selected-stable'});
 check(document.querySelector('.search-popover [role="status"]').getBoundingClientRect().width>0,'匹配反馈在勾选时持续可见');
 await input({click:'header [aria-haspopup="dialog"]'});await input({key:'Tab'});check(document.activeElement.textContent==='新增口播片段','查找自身保留新增访问路径');
 await input({key:'Tab'});await input({key:'Enter'});check(state.exportRequests.length===1&&state.exportRequests[0].length===1,'查找勾选不改变全片导出范围');selected(['a','b']);layout();
 await input({click:'[row-id="a"] [col-id="text"]',button:'right'});await input({click:'[aria-label="查找文案"]'});check(document.activeElement===search()&&!document.querySelector('[role="menu"]'),'外部点击关闭菜单并保留查找输入焦点');selected(['a','b']);
 await input({click:'[row-id="a"] [col-id="text"]',button:'right'});await input({key:'Escape'});selected(['a','b']);check(!document.querySelector('[role="menu"]')&&search(),'行菜单 Escape 保留查找和勾选');
 await input({key:'Escape'});selected([]);layout();
 await input({click:'[row-id="a"] [col-id="text"]'});
 check(document.querySelector('[aria-label="文案全文"]')&&document.querySelector('[row-id="a"] [aria-label^="拖动片段 "]').disabled,'全文编辑期间拖拽禁用');
 let nativeContext;document.addEventListener('contextmenu',event=>{setTimeout(()=>{nativeContext={prevented:event.defaultPrevented,tag:event.target.tagName};},0);},{once:true,capture:true});
 await input({click:'[aria-label="文案全文"]',button:'right'});check(nativeContext?.tag==='TEXTAREA'&&!nativeContext.prevented&&!document.querySelector('[role="menu"]'),'编辑文案保留系统右键菜单，不隐含行操作');
 await input({key:'Escape'});await poll();selected(['a']);
 for(const lock of ['taskLocked','speech','codex','user']){
  await input({click:'[row-id="a"] [col-id="text"]',button:'right'});
  await input({key:'Home'});check(document.activeElement.textContent==='删除口播片段','锁前聚焦可执行项');
  if(lock==='taskLocked')state.status.taskLocked=true;else if(lock==='speech')state.speech={locked:true,voice:{},tasks:[],operations:[],audio:[]};else state.status.modification={owner:lock};await poll();
  check(document.querySelectorAll('[role="menu"] [role="menuitem"]').length===3,'全部三项仍显示');
  check([...document.querySelectorAll('[role="menu"] [role="menuitem"]')].every(node=>node.getAttribute('aria-disabled')==='true')&&document.querySelector('[row-id="a"] [aria-label^="拖动片段 "]').disabled,'动态锁禁用修改入口 '+lock);
  for (const item of document.querySelectorAll('[role="menu"] [role="menuitem"]')) assertTheme('disabled', item);
  check(document.activeElement.matches('[role="menu"]'),'动态禁用后保留菜单有效焦点 '+document.activeElement.outerHTML);
  await input({key:'Escape'});selected(['a']);check(document.activeElement.isConnected&&!document.querySelector('[role="menu"]'),'锁定菜单关闭后焦点有效');
  state.status.taskLocked=false;state.status.modification=null;if(state.speech)state.speech.locked=false;await poll();
 }
 await input({click:'[aria-label="查找文案"]'});await input({key:'Escape'});
 check(!search()&&document.activeElement.classList.contains('search-trigger'),'关闭查找回可见入口');selected(['a']);check(geometry()===baseline,'关闭查找保持表格');
 document.getElementById('result').dataset.state='passed';
}catch(error){document.getElementById('result').dataset.state='failed';document.getElementById('result').textContent=error.stack;}})();
`;
for(const width of [1600,420])test('查找勾选保持布局及新行菜单 Escape 层级 '+width,{skip:chrome?false:'未执行：需要 Chrome/Chromium',timeout:40000},t=>checkInteractiveBrowser(t,script,fixture,width));
