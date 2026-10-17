import { test } from 'node:test';
import { fixture } from './helpers/editing-fixture.js';
import { checkInteractiveBrowser } from './helpers/interactive-browser.js';

const loaded = { schemaVersion: 2, state: 'known', version: 'panel-test', source: { commit: null, state: 'clean' },
  contentFingerprint: `sha256:${'a'.repeat(64)}`, runtimeFingerprint: `sha256:${'b'.repeat(64)}`, panelFingerprint: `sha256:${'a'.repeat(64)}`, protocolVersion: 1 };
const updateFixture = fixture.replace("tableId: 'table', select:", "tableId: 'table', activity: async busy => { (state.panelActivity ??= []).push(busy); }, select:");
const common = String.raw`
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './src/panel/app.tsx';
import { buildIdentity } from './src/build-identity.ts';
import { state } from 'editing-fixture';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const check=(ok,message)=>{if(!ok)throw Error(message);};
const timers=new Map();let serial=0;
window.setInterval=fn=>{timers.set(++serial,fn);return serial;};window.clearInterval=id=>timers.delete(id);
const settle=()=>new Promise(r=>setTimeout(r,120));
const action=async fn=>{await act(async()=>{await fn();await settle();});await settle();};
const poll=()=>action(()=>{[...timers.values()].forEach(fn=>fn());});
state.status.buildIdentity=buildIdentity;state.status.activePanelIdentity=buildIdentity;
const refresh=()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='刷新面板');
`;

const busy = common + String.raw`
(async()=>{try{
 await action(()=>createRoot(document.getElementById('root')).render(<App/>));await poll();
 check(state.panelActivity?.at(-1)===false,'正常空闲面板上报idle');
 await action(()=>{state.status.activePanelIdentity={...buildIdentity,panelFingerprint:'sha256:'+'c'.repeat(64)};});await poll();
 check(refresh()&&!refresh().disabled,'运行时相同的新面板显示刷新入口');
 await action(()=>window.browserInput({click:'[row-id="segment"] [data-segment-script]'}));
 const editor=document.querySelector('[aria-label="文案全文"]');check(editor,'进入原有行内编辑');
 await action(()=>{editor.value='保留未提交草稿';editor.dispatchEvent(new Event('input',{bubbles:true}));});
 check(refresh().disabled&&state.panelActivity.at(-1)===true,'编辑中阻止刷新并报告busy');
 check(editor.value==='保留未提交草稿','更新提示不丢草稿');
 await action(()=>window.browserInput({key:'Escape'}));await poll();
 check(!refresh().disabled,'结束编辑后恢复刷新入口');
 const video=document.createElement('video');let paused=false;Object.defineProperty(video,'paused',{get:()=>paused});document.body.append(video);
 await action(()=>video.dispatchEvent(new Event('play')));check(refresh().disabled,'浮窗或详情播放器播放时阻止刷新');
 await action(()=>{paused=true;video.dispatchEvent(new Event('pause'));});video.remove();check(!refresh().disabled,'暂停后恢复入口');
 const removed=document.createElement('video');Object.defineProperty(removed,'paused',{get:()=>false});document.body.append(removed);
 await action(()=>removed.dispatchEvent(new Event('play')));check(refresh().disabled,'移除前确实处于播放忙态');
 await action(()=>removed.remove());check(!refresh().disabled,'直接移除播放组件后重新核对媒体忙态');
 await action(()=>{state.status.taskLocked=true;});await poll();check(refresh().disabled,'制作任务锁阻止刷新');
 check(state.saves===0&&state.mutations.length===0,'查看更新不产生项目制作或保存请求');
 document.getElementById('result').dataset.state='passed';
}catch(error){document.getElementById('result').dataset.state='failed';document.getElementById('result').textContent=error.stack;}})();
`;

const restore = common + String.raw`
(async()=>{try{
 state.status.snapshot.segments=[{id:'s1',order:1,text:'第一段',visualNote:'',video:null},{id:'s2',order:2,text:'第二段',visualNote:'',video:null}];
 const key='clapgrid-panel-refresh:'+location.origin+location.pathname.replace(/\/$/,'');
 sessionStorage.setItem(key,JSON.stringify({projectId:'project',instanceId:'test',panelFingerprint:buildIdentity.panelFingerprint,selectedIds:['s2','deleted'],createdAt:Date.now()}));
 await action(()=>createRoot(document.getElementById('root')).render(<App/>));await poll();await poll();
 check(state.selectionRequests.at(-1).join()==='s2','刷新重连只同步仍存在的稳定片段身份');
 check(document.querySelector('[row-id="s2"]').classList.contains('ag-row-selected')&&!document.querySelector('[row-id="s1"]').classList.contains('ag-row-selected'),'表格可见勾选与服务一致');
 check(sessionStorage.getItem(key)===null,'恢复记录只消费一次');
 await action(()=>state.tableConnections.at(-1).resolve());
 check(!document.querySelector('[row-id="s2"]').classList.contains('ag-row-selected'),'恢复之后再次断线仍清除旧勾选');
 check(state.saves===0&&state.mutations.length===0,'恢复不把选择变成全项目制作');
 document.getElementById('result').dataset.state='passed';
}catch(error){document.getElementById('result').dataset.state='failed';document.getElementById('result').textContent=error.stack;}})();
`;

test('面板快更新在编辑、播放与任务期间保持草稿并禁止刷新', { timeout: 30000 }, t => checkInteractiveBrowser(t, busy, updateFixture, 780, 579, { buildDefine: { __CLAPGRID_BUILD_IDENTITY__: JSON.stringify(loaded) } }));
test('面板刷新后的真实表格重连恢复稳定勾选且断线仍清除', { timeout: 30000 }, t => checkInteractiveBrowser(t, restore, updateFixture, 780, 579, { buildDefine: { __CLAPGRID_BUILD_IDENTITY__: JSON.stringify(loaded) } }));

const manual = common + String.raw`
(async()=>{try{
 state.tableGate={};state.tableGate.promise=new Promise(resolve=>state.tableGate.resolve=resolve);
 state.status.snapshot.segments=[{id:'s1',order:1,text:'新选择',visualNote:'',video:null},{id:'s2',order:2,text:'旧选择',visualNote:'',video:null}];
 const key='clapgrid-panel-refresh:'+location.origin+location.pathname.replace(/\/$/,'');
 sessionStorage.setItem(key,JSON.stringify({projectId:'project',instanceId:'test',panelFingerprint:buildIdentity.panelFingerprint,selectedIds:['s2'],createdAt:Date.now()}));
 await action(()=>createRoot(document.getElementById('root')).render(<App/>));
 await action(()=>window.browserInput({click:'[row-id="s1"] input[type="checkbox"]'}));
 await action(()=>state.tableGate.resolve());await poll();
 check(state.selectionRequests.at(-1).join()==='s1','迟到恢复不覆盖等待期间用户的新勾选');
 check(document.querySelector('[row-id="s1"]').classList.contains('ag-row-selected')&&!document.querySelector('[row-id="s2"]').classList.contains('ag-row-selected'),'界面保留新选择');
 document.getElementById('result').dataset.state='passed';
}catch(error){document.getElementById('result').dataset.state='failed';document.getElementById('result').textContent=error.stack;}})();
`;
test('迟到的刷新恢复让位于用户的新勾选', { timeout: 30000 }, t => checkInteractiveBrowser(t, manual, updateFixture.replace('export async function connectTable() {', 'export async function connectTable() { if(state.tableGate)await state.tableGate.promise;'), 780, 579, { buildDefine: { __CLAPGRID_BUILD_IDENTITY__: JSON.stringify(loaded) } }));
