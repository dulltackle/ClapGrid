import { test } from './helpers/playwright-browser.js';

import { fixture } from './helpers/editing-fixture.js';


const setup = String.raw`
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './src/panel/app.tsx';
import { state, deferred } from 'editing-fixture';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const timers=new Map();let timer=0;window.setInterval=callback=>{timers.set(++timer,callback);return timer;};window.clearInterval=id=>timers.delete(id);
const settle=()=>new Promise(resolve=>setTimeout(resolve,70));
const action=async callback=>{await act(async()=>{await callback();await settle();});await settle();};
const check=(value,message)=>{if(!value)throw Error(message);};
const button=(name,root=document)=>[...root.querySelectorAll('button')].find(node=>(node.getAttribute('aria-label')??node.textContent)===name);
const mouse=node=>action(async()=>{check(node&&!node.disabled,'入口可用');const rect=node.getBoundingClientRect();for(const type of ['mousePressed','mouseReleased'])await window.browserInput({pointer:{type,x:rect.x+rect.width/2,y:rect.y+rect.height/2}});});
const click=name=>mouse(button(name));
const key=key=>action(()=>window.browserInput({key}));
const search=()=>document.querySelector('[aria-label="查找文案"]');
const draft=()=>document.querySelector('[aria-label="详情文案"]');
const selected=()=>[...document.querySelectorAll('[row-id][aria-selected="true"]')].map(row=>row.getAttribute('row-id'));
const poll=()=>action(()=>[...timers.values()].forEach(callback=>callback()));
const mount=()=>action(()=>{state.status.snapshot.segments=[{id:'a',order:1,text:'A',visualNote:'',video:null},{id:'b',order:2,text:'B',visualNote:'',video:null},{id:'c',order:3,text:'C',visualNote:'',video:null}];createRoot(document.getElementById('root')).render(<App/>);});
const add=async entry=>{if(entry==='更多'){await click('更多');await mouse(button('新增口播片段',document.querySelector('[role="dialog"][aria-modal="true"]')));}else await click(entry==='底部'?'新增口播片段（表格底部）':'新增口播片段');};
`;
const addFixture=fixture.replace('if (state.acquireGate) await state.acquireGate.promise;', 'if (state.acquireGate) await state.acquireGate.promise; if (state.detailGate && state.leases.length > 1) await state.detailGate.promise;');
function page(name: string, body: string, http=addFixture) {
 test(name,async ({ panel }) => { test.setTimeout(40000);return panel.check(setup+`(async()=>{try{await mount();${body}document.getElementById('result').dataset.state='passed';}catch(error){document.getElementById('result').dataset.state='failed';document.getElementById('result').textContent=error.stack;}})();`,http,1200,800);});
}
page('普通新增迟到成功保留新查找、勾选与焦点并接收数据',String.raw`
 await action(()=>window.browserInput({click:'[row-id="a"] input[type="checkbox"]'}));
 state.saveGate=deferred();await add('顶部');check(state.batchRequests.length===1,'已发出一次真实新增');
 await click('查找');await key('B');
 const active=document.activeElement,selection=selected().join(','),vertical=document.querySelector('.ag-body-vertical-scroll-viewport'),scroll=vertical.scrollTop;
 await action(()=>{state.saveGate.resolve();state.saveGate=null;});
 check(state.status.snapshot.segments.length===4 && document.querySelector('[row-id="created-1"]'),'有效新增数据仍接收');
 check(document.querySelector('[data-save-status]').textContent==='已保存','有效新增成功状态保留');
 check(search()?.value==='B' && document.activeElement===active,'迟到新增不关闭查找、清查询或抢焦点');
 check(selected().join(',')===selection && vertical.scrollTop===scroll && !draft() && !document.querySelector('[aria-label="文案全文"]'),'迟到新增不滚动、选中新行、开详情或进入编辑');
`);
for(const entry of ['顶部','底部','更多']) page(`${entry}普通新增保留正常创建选中编辑与统一关闭`,String.raw`
 await click('查找');await key('A');
 await add('${entry}');
 check(state.batchRequests.length===1 && JSON.stringify(state.batchRequests[0].changes)==='[{"kind":"add","text":""}]','一次普通末尾新增请求');
 check(state.status.snapshot.segments.length===4 && document.activeElement===draft() && draft().value==='' && !draft().readOnly,'真实新增详情聚焦文案并持有修改权');
 check(!search() && selected().join(',')==='created-1','正常路径清查找并选中新行');
 await key('Escape');check(document.activeElement.closest('[row-id]')?.getAttribute('row-id')==='created-1','关闭新增详情返回新片段');
 await key('ArrowUp');check(document.activeElement.closest('[row-id]')?.getAttribute('row-id')==='c','真实方向键继续导航');
`);
for(const turn of ['查找输入','键盘导航','空白点击','滚轮','其他流程','离开返回']) page(`普通新增等待响应：${turn}永久取消自动导航`,String.raw`
 if('${turn}'==='滚轮'){state.status.snapshot.segments.push(...Array.from({length:50},(_,i)=>({id:'tail-'+i,order:i+4,text:'后续 '+i,visualNote:'',video:null})));await poll();}
 await action(()=>window.browserInput({click:'[row-id="a"] input[type="checkbox"]'}));
 const count=state.status.snapshot.segments.length;
 state.saveGate=deferred();await add('顶部');
 if('${turn}'==='查找输入'){await click('查找');await key('B');}
 if('${turn}'==='键盘导航'){await action(()=>document.querySelector('[row-id="a"] [col-id="text"]').focus());await key('ArrowDown');}
 if('${turn}'==='空白点击'){await action(async()=>{for(const type of ['mousePressed','mouseReleased'])await window.browserInput({pointer:{type,x:5,y:5}});});}
 if('${turn}'==='滚轮'){await action(()=>window.browserInput({pointer:{type:'mouseWheel',x:200,y:230,deltaY:100}}));}
 if('${turn}'==='其他流程')await click('更多');
 if('${turn}'==='离开返回')await action(()=>{window.dispatchEvent(new Event('pagehide'));window.dispatchEvent(new Event('pageshow'));});
 const before=document.activeElement,selection=selected().join(','),vertical=document.querySelector('.ag-body-vertical-scroll-viewport'),scroll=vertical.scrollTop,query=search()?.value;
 await action(()=>{state.saveGate.resolve();state.saveGate=null;});await poll();
 check(state.status.snapshot.segments.length===count+1,'新增业务结果没有撤销');
 if('${turn}'==='滚轮')check(scroll>0,'真实手动滚轮已移动表格');
 check(document.activeElement===before && selected().join(',')===selection && vertical.scrollTop===scroll && search()?.value===query && !draft(),'迟到结果保留新焦点、勾选、滚动、查找与面板');
 if('${turn}'==='其他流程')check(document.querySelector('[role="dialog"][aria-modal="true"]')?.contains(document.activeElement),'新流程继续拥有焦点');
`);
for(const turn of ['查找输入','键盘导航','空白点击','滚轮','其他流程','离开返回']) page(`普通新增等待详情修改权：${turn}永久取消旧聚焦`,String.raw`
 if('${turn}'==='滚轮'){state.status.snapshot.segments.push(...Array.from({length:50},(_,i)=>({id:'tail-'+i,order:i+4,text:'后续 '+i,visualNote:'',video:null})));await poll();}
 const count=state.status.snapshot.segments.length;
 state.detailGate=deferred();await add('顶部');
 const positioned=document.querySelector('.ag-body-vertical-scroll-viewport').scrollTop;
 check(draft() && state.leases.length===2 && state.current,'新增已接收且详情修改权正在等待');
 if('${turn}'==='查找输入'){await click('查找');await key('B');}
 if('${turn}'==='键盘导航')await key('Tab');
 if('${turn}'==='空白点击'){await action(async()=>{for(const type of ['mousePressed','mouseReleased'])await window.browserInput({pointer:{type,x:5,y:5}});});}
 if('${turn}'==='滚轮')await action(()=>window.browserInput({pointer:{type:'mouseWheel',x:200,y:250,deltaY:-600}}));
 if('${turn}'==='其他流程')await click('更多');
 if('${turn}'==='离开返回')await action(()=>{window.dispatchEvent(new Event('pagehide'));window.dispatchEvent(new Event('pageshow'));});
 const before=document.activeElement,selection=selected().join(','),vertical=document.querySelector('.ag-body-vertical-scroll-viewport'),scroll=vertical.scrollTop,query=search()?.value;
 await action(()=>{state.detailGate.resolve();state.detailGate=null;});
 check(state.status.snapshot.segments.length===count+1,'新增业务数据保留');
 if('${turn}'==='滚轮')check(scroll<positioned,'等待修改权时真实滚轮已移开新增定位');
 check(document.activeElement===before && selected().join(',')===selection && vertical.scrollTop===scroll && search()?.value===query && draft()?.readOnly && !state.current,'迟到修改权不抢新焦点、滚动、勾选、查询或重新进入编辑');
`);
page('普通新增响应后释放修改权等待期间的新操作取消后续详情导航',String.raw`
 state.releaseGate=deferred();await add('顶部');
 check(state.status.snapshot.segments.length===4 && !draft(),'数据已接收但新增原修改权尚未释放完成');
 await click('查找');await key('B');const before=document.activeElement,selection=selected().join(',');
 await action(()=>{state.releaseGate.resolve();state.releaseGate=null;});
 check(document.activeElement===before && search()?.value==='B' && selected().join(',')===selection && !draft(),'响应到后续导航之间的新操作仍能永久取消旧意图');
`,addFixture.replace('lease.closes++; lease.disconnect();','lease.closes++; lease.disconnect(); if (state.releaseGate) await state.releaseGate.promise;'));
page('普通新增详情聚焦帧等待期间的新操作不取得编辑权',String.raw`
 const nativeFrame=window.requestAnimationFrame,nativeCancel=window.cancelAnimationFrame,callbacks=new Map();let frame=0;
 window.requestAnimationFrame=callback=>{const id=--frame;callbacks.set(id,callback);return id;};window.cancelAnimationFrame=id=>{if(id<0)callbacks.delete(id);else nativeCancel(id);};
 await add('顶部');check(draft() && state.leases.length===1,'详情已导航但聚焦帧尚未执行');
 await click('查找');await key('B');const before=document.activeElement,selection=selected().join(',');
 window.requestAnimationFrame=nativeFrame;window.cancelAnimationFrame=nativeCancel;
 await action(()=>{const batch=[...callbacks.values()];callbacks.clear();for(const callback of batch)callback(performance.now());});
 check(document.activeElement===before && search()?.value==='B' && selected().join(',')===selection && !state.current && draft().readOnly,'旧新增聚焦帧不抢查找或取得修改权');
`);
page('普通新增失败保留新的查找且不制造虚假行',String.raw`
 state.addFailureGate=deferred();await add('顶部');
 await click('查找');await key('B');const before=document.activeElement,selection=selected().join(',');
 await action(()=>{state.addFailureGate.resolve();state.addFailureGate=null;});
 check(state.status.snapshot.segments.length===3 && !document.querySelector('[row-id^="created-"]') && !draft(),'失败不制造虚假行或详情');
 check(search()?.value==='B' && document.activeElement===before && selected().join(',')===selection && document.querySelector('[data-save-status]').textContent.includes('失败'),'迟到失败沿用业务错误状态但不改变新查找和勾选');
`,addFixture.replace("if (state.batchFailure) throw Error('多行新增失败');", "if (state.addFailureGate) { const gate=state.addFailureGate; await gate.promise; throw Error('新增失败'); } if (state.batchFailure) throw Error('多行新增失败');"));
page('普通新增旧响应失效后不覆盖新新增的详情、焦点或修改权',String.raw`
 state.saveGate=deferred();const oldGate=state.saveGate;await add('顶部');
 await action(()=>{window.dispatchEvent(new Event('pagehide'));window.dispatchEvent(new Event('pageshow'));state.saveGate=null;});
 await add('顶部');check(document.activeElement===draft() && selected().join(',')==='created-2','后续新增已获得自己的详情与修改权');
 const before=document.activeElement,lease=state.current;
 await action(()=>oldGate.resolve());
 check(state.status.snapshot.segments.length===5 && document.activeElement===before && draft()?.value==='' && selected().join(',')==='created-2' && state.current===lease && lease.closes===0,'旧成功响应不覆盖新数据、来源、选中、聚焦或编辑租约');
`);
page('普通新增旧失败失效后不覆盖较新成功状态或修改权',String.raw`
 state.addFailureGate=deferred();const oldGate=state.addFailureGate;await add('顶部');
 await action(()=>{window.dispatchEvent(new Event('pagehide'));window.dispatchEvent(new Event('pageshow'));state.addFailureGate=null;});
 await add('顶部');const before=document.activeElement,lease=state.current;
 await action(()=>oldGate.resolve());
 check(state.status.snapshot.segments.length===4 && document.activeElement===before && document.querySelector('[data-save-status]').textContent==='已保存' && !document.body.textContent.includes('旧新增失败') && state.current===lease && lease.closes===0,'失效旧失败不得覆盖后续成功与正在编辑的修改权');
`,addFixture.replace("if (state.batchFailure) throw Error('多行新增失败');", "if (state.addFailureGate) { const gate=state.addFailureGate; await gate.promise; throw Error('旧新增失败'); } if (state.batchFailure) throw Error('多行新增失败');"));
for(const change of ['重排','删除','空表','虚拟卸载']) page(`新增详情关闭：${change}采用统一返回规则`,String.raw`
 await add('顶部');
 const save=button('保存文案');check(save,'新增详情已取得编辑草稿');await mouse(save);
 check(!state.current,'保存后可接收外部项目刷新');
 if('${change}'==='重排'){const created=state.status.snapshot.segments.pop();state.status.snapshot.segments.unshift(created);}
 if('${change}'==='删除')state.status.snapshot.segments=state.status.snapshot.segments.filter(segment=>segment.id!=='created-1');
 if('${change}'==='空表')state.status.snapshot.segments=[];
 if('${change}'==='虚拟卸载')state.status.snapshot.segments.push(...Array.from({length:60},(_,i)=>({id:'tail-'+i,order:i+5,text:'后续 '+i,visualNote:'',video:null})));
 await poll();
 if('${change}'==='虚拟卸载'){await action(()=>{document.querySelector('.ag-body-vertical-scroll-viewport').scrollTop=4500;});check(!document.querySelector('[row-id="created-1"]'),'原入口已真实离开虚拟窗口');}
 await mouse(button('关闭详情'));
 const id=document.activeElement.closest('[row-id]')?.getAttribute('row-id');
 if('${change}'==='空表')check(document.activeElement===button('查找'),'空表走可见页面后备');
 else check(id===('${change}'==='删除'?'c':'created-1'),'目标变化后返回稳定身份或原显示位置当前末行');
`);
page('普通新增迟到响应不打断用户请求的现有片段行内编辑',String.raw`
 state.saveGate=deferred();await add('顶部');
 await action(()=>window.browserInput({click:'[row-id="b"] [data-segment-script]'}));
 await action(()=>{state.saveGate.resolve();state.saveGate=null;});
 const editor=document.querySelector('[aria-label="文案全文"]');
 check(editor?.value==='B' && document.activeElement===editor && !draft(),'新增只接收数据，保留用户在等待期间请求的 B 行内编辑');
 await key('X');check(editor.value==='X','旧新增未占用或打断新的编辑状态');
`);
page('普通新增虚拟定位后的手动滚动取消尚未执行的详情聚焦',String.raw`
 state.status.snapshot.segments.push(...Array.from({length:50},(_,i)=>({id:'tail-'+i,order:i+4,text:'后续 '+i,visualNote:'',video:null})));await poll();
 const nativeFrame=window.requestAnimationFrame,nativeCancel=window.cancelAnimationFrame,callbacks=new Map();let frame=0;
 window.requestAnimationFrame=callback=>{const id=--frame;callbacks.set(id,callback);return id;};window.cancelAnimationFrame=id=>{if(id<0)callbacks.delete(id);else nativeCancel(id);};
 await add('顶部');
 const vertical=document.querySelector('.ag-body-vertical-scroll-viewport');check(vertical.scrollTop>1000,'正常新增已实际定位至虚拟表格末行');
 await action(()=>window.browserInput({pointer:{type:'mouseWheel',x:200,y:250,deltaY:-600}}));
 const scroll=vertical.scrollTop,before=document.activeElement,selection=selected().join(',');
 window.requestAnimationFrame=nativeFrame;window.cancelAnimationFrame=nativeCancel;
 await action(()=>{const batch=[...callbacks.values()];callbacks.clear();for(const callback of batch)callback(performance.now());});
 check(vertical.scrollTop===scroll && document.activeElement===before && selected().join(',')===selection && draft()?.readOnly && !state.current,'后续帧保留手动滚动和原编辑状态，不补旧聚焦或修改权');
`);
