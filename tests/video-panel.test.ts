import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome } from './helpers/browser.js';
import { fixture } from './helpers/editing-fixture.js';
import { checkInteractiveBrowser } from './helpers/interactive-browser.js';

const script = String.raw`
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './src/panel/app.tsx';
import { state, deferred } from 'editing-fixture';
import { assertTheme } from './tests/helpers/theme-contract.ts';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const timers = new Map(); let timer = 0;
window.setInterval = callback => { timers.set(++timer, callback); return timer; };
window.clearInterval = id => timers.delete(id);
const check = (v, m) => { if (!v) throw Error(m); };
const settle = () => new Promise(r => setTimeout(r, 60));
const button = text => [...document.querySelectorAll('button')].find(n => n.textContent === text);
const field = label => document.querySelector('[aria-label="'+label+'"]');
const layer = label => label === '画面素材详情' ? document.querySelector('[aria-label="口播片段详情"]') : document.querySelector('[role="dialog"][aria-label="'+label+'"]');
const click = async n => { await act(async () => { check(n && !n.disabled, '入口可用'); n.focus(); n.click(); await settle(); }); await settle(); };
const key = async (key, shift = false) => { await act(async () => { await window.browserInput({key, shift}); await settle(); }); await settle(); };
const poll = async () => { await act(async () => { [...timers.values()].forEach(f => f()); await settle(); }); await settle(); };
const input = async (n, value) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,value); n.dispatchEvent(new Event('input',{bubbles:true})); await settle(); }); };
const geometry = async (d, name) => {
 await new Promise(r => setTimeout(r,350));
 const r = d.getBoundingClientRect(); check(r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, '浮层位于视口');
 check(d.scrollWidth <= d.clientWidth, '无横向溢出'); if(d.tagName !== 'ASIDE') assertTheme('dialog',d); else check(getComputedStyle(d).backgroundColor==='rgb(255, 255, 255)' && getComputedStyle(d).borderLeftWidth==='1px', '侧栏保持亮色与分隔边框');
 for (const n of d.querySelectorAll('input,select')) assertTheme('form',n);
 if (d.tagName !== 'ASIDE') for (const n of d.querySelectorAll('button')) assertTheme('cancel',n);
 for (const n of d.querySelectorAll('button,input,select,video')) { n.scrollIntoView({block:'nearest'}); const b=n.getBoundingClientRect(); check(b.top >= r.top && b.bottom <= r.bottom, '控件可滚动到达'); }
 await window.browserInput({screenshot: name+'-'+innerHeight});
};
(async () => { try {
 state.status.snapshot.assets = [{id:'asset',name:'示例素材.mp4',duration:60}];
 state.status.snapshot.segments[0].video = {assetId:'asset',start:2};
 await act(async () => { createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>); await settle(); }); await settle();
 document.querySelector('.ag-body-horizontal-scroll-viewport').scrollLeft=600; await settle();
 await click(field('查看片段 1 的详情')); const parent=layer('画面素材详情'); check(parent, '片段详情采用非模态区域'); await geometry(parent,'details');
 await click(button('播放预览')); const preview=layer('视频预览'); check(preview && preview.contains(document.activeElement), '嵌套预览初始焦点');
 check(preview.querySelector('video').controls, '保留原生播放控件'); await geometry(preview,'preview');
 await key('Tab'); await poll(); check(preview.contains(document.activeElement), '父层轮询不能夺走子层焦点');
 for(let i=0;i<6;i++){await key('Tab',i>2);check(preview.contains(document.activeElement),'键盘约束在预览');}
 await key('Escape'); check(document.activeElement===button('播放预览'),'关闭预览返回原入口');
 button('更改').focus(); state.status.taskLocked=true; await poll(); check(button('更改').disabled && document.activeElement===parent,'动态锁禁用后退回父层容器'); state.status.taskLocked=false; await poll();
 await click(button('更改')); const editor=layer('关联视频'); check(editor && document.activeElement===editor,'关联初始焦点');
 await geometry(editor,'editor'); await input(field('播放起点（秒）'),'8');
 state.saveGate=deferred(); await click(button('保存关联与起点')); const gate=state.saveGate; state.saveGate=null; const lease=state.current;
 check(editor.contains(document.activeElement),'保存禁用后有后备焦点'); await key('Escape'); check(!layer('关联视频') && parent.contains(document.activeElement),'保存中取消返回正确父层');
 await act(async()=>{gate.resolve();await settle();}); check(lease.closes===1 && !layer('关联视频'),'迟到保存不重开或重复释放');
 await key('Escape'); await poll();
 state.acquireGate=deferred(); await click(field('查看片段 1 的详情')); await click(button('更改')); await key('Escape');
 await click(button('查找')); const search=field('查找文案'); search.focus();
 await act(async()=>{state.acquireGate.resolve();state.acquireGate=null;await settle();}); await settle();
 check(!layer('关联视频') && document.activeElement===search && !state.current,'等待修改权后已转移操作不重开抢焦点并释放旧修改权：'+JSON.stringify({editor:!!layer('关联视频'),active:document.activeElement?.outerHTML,lease:!!state.current}));
 await poll(); await click(button('更多')); await click(button('导入本地视频'));
 const importing=layer('导入本地视频'); check(importing && button('导入并复制').disabled,'空路径不能导入');
 check(field('视频文件绝对路径') instanceof HTMLInputElement,'保留原生路径输入');
 await geometry(importing,'import'); await input(field('视频文件绝对路径'),'/tmp/new.mp4');
 await click(button('导入并复制')); check(!layer('导入本地视频') && !state.current,'导入成功关闭并释放修改权');
 await poll(); await click(button('更多')); await click(button('导入本地视频')); await input(field('视频文件绝对路径'),'/missing.mp4');
 state.importFailure=true; await click(button('导入并复制')); check(document.body.textContent.includes('视频导入失败') && !state.current,'导入失败反馈并释放修改权'); state.importFailure=false;
 await poll(); await click(button('更多')); await click(button('导入本地视频')); await input(field('视频文件绝对路径'),'/tmp/slow.mp4');
 state.saveGate=deferred(); await click(button('导入并复制')); const importGate=state.saveGate; state.saveGate=null; const importLease=state.current;
 await key('Escape'); check(!layer('导入本地视频') && importLease.closes===1,'导入中Escape取消并释放');
 await poll(); await click(button('更多')); await click(button('导出设置')); await click(button('编辑设置')); const newLease=state.current; const settings=document.activeElement.closest('[role="dialog"]');
 await act(async()=>{importGate.resolve();await settle();}); check(state.current===newLease && newLease.closes===0 && settings.contains(document.activeElement) && !layer('导入本地视频'),'迟到导入不影响后续编辑会话');
 await key('Escape');
 await poll(); await click(field('查看片段 1 的详情')); await click(button('播放预览')); state.status.snapshot.segments=[]; await poll(); await key('Escape');
 check(layer('画面素材详情').contains(document.activeElement) && layer('画面素材详情').textContent.includes('片段已删除'),'片段删除后关闭嵌套层仍回详情');
 await key('Escape'); check(document.activeElement===search,'片段与表格消失后恢复查找后备');

 document.getElementById('result').dataset.state='passed';
 } catch(e){document.getElementById('result').dataset.state='failed';document.getElementById('result').textContent=e.stack;}})();
`;
for (const [width, height] of [[1600,1000],[420,800],[360,320]]) {
  test(`画面素材嵌套、取消及迟到响应（${width}×${height}）`, { timeout: 40000 }, t => {
    assert.ok(chrome, '需要 Chrome 执行视频验收');
    return checkInteractiveBrowser(t, script, fixture.replace('export async function importVideo() {', "export async function importVideo() { if (state.importFailure) throw Error('视频导入失败');"), width, height);
  });
}

const abandonedEditorScript = script.slice(0, script.indexOf('\n(async () =>')) + String.raw`
(async () => { try {
 state.status.snapshot.assets=[{id:'asset',name:'示例.mp4',duration:60}];state.status.snapshot.segments[0].video={assetId:'asset',start:0};
 await act(async()=>{createRoot(document.getElementById('root')).render(<App/>);await settle();});await settle();
 await click(field('查看片段 1 的详情'));const parent=layer('画面素材详情');
 state.acquireGate=deferred();await click(button('更改'));
 check(state.current && !layer('关联视频'),'关联请求正在等待真实修改权响应');
 await act(async()=>{await window.browserInput({click:'.search-trigger'});await settle();});await settle();
 check(document.activeElement===field('查找文案'),'真实新操作已转向查找');
 await key('Escape');
 await act(async()=>{await window.browserInput({click:'[aria-label="口播片段详情"] h2'});await settle();});await settle();
 check(parent.contains(document.activeElement),'用户已返回仍存续的父详情');
 await act(async()=>{state.acquireGate.resolve();state.acquireGate=null;await settle();});await settle();
 check(!layer('关联视频') && parent.contains(document.activeElement) && !state.current,'回到父详情不能重新取得旧关联请求的导航权，迟到修改权释放');
 await key('Escape');check(document.activeElement===field('查看片段 1 的详情'),'取消子请求后父流程仍能回原表格入口');
 document.getElementById('result').dataset.state='passed';
}catch(e){document.getElementById('result').dataset.state='failed';document.getElementById('result').textContent=e.stack;}})();
`;
test('离开关联请求再回父详情不复活迟到修改权', {timeout:40000}, t=>{assert.ok(chrome);return checkInteractiveBrowser(t,abandonedEditorScript,fixture,1200,800);});

const unavailableParentScript = (unavailable: string) => script.slice(0, script.indexOf('\n(async () =>')) + String.raw`
(async () => { try {
 state.status.snapshot.assets=[{id:'asset',name:'示例.mp4',duration:60}];
 state.status.snapshot.segments=['a','b'].map((id,i)=>({id,order:i+1,text:id,video:{assetId:'asset',start:0}}));
 await act(async()=>{createRoot(document.getElementById('root')).render(<App/>);await settle();});await settle();
 field('查看片段 1 的详情').focus();await key('Enter');const parent=layer('画面素材详情');
 check(parent,'真实键盘可打开父详情');
 const entry=button('播放预览');entry.focus();await key('Enter');
 check(layer('视频预览')?.contains(document.activeElement),'真实键盘可打开嵌套预览');
 ${unavailable}
 await key('Escape');check(!layer('视频预览') && document.activeElement===parent,'父入口失效后返回仍存续的父层容器');
 await key('Escape');check(document.activeElement===field('查看片段 1 的详情'),'子返回没有丢失父流程自己的表格来源');
 await key('ArrowDown');check(document.activeElement.closest('[row-id]')?.getAttribute('row-id')==='b','连续关闭后可从正确片段继续真实表格导航');
 check(!state.saves && !state.mutations.length,'查看和关闭不写入业务数据');
 document.getElementById('result').dataset.state='passed';
}catch(e){document.getElementById('result').dataset.state='failed';document.getElementById('result').textContent=e.stack;}})();
`;
for(const [name,environment] of [['卸载','entry.remove();'],['不可见','entry.hidden=true;'],['禁用','entry.disabled=true;']] as const)test('嵌套预览父入口'+name+'后仍可连续返回表格',{timeout:40000},t=>{assert.ok(chrome);return checkInteractiveBrowser(t,unavailableParentScript(environment),fixture,1200,800);});

const failedAssociationScript=script.slice(0,script.indexOf('\n(async () =>'))+String.raw`
(async()=>{try{
 state.status.snapshot.assets=[{id:'asset',name:'示例.mp4',duration:60}];state.status.snapshot.segments[0].video={assetId:'asset',start:0};
 await act(async()=>{createRoot(document.getElementById('root')).render(<App/>);await settle();});await settle();
 await click(field('查看片段 1 的详情'));const parent=layer('画面素材详情');await click(button('更改'));
 state.batchFailure=true;await click(button('保存关联与起点'));
 check(!layer('关联视频') && !state.current && parent.contains(document.activeElement),'关联保存失败仍按业务规则关闭编辑层、释放修改权并返回父层');
 check(document.body.textContent.includes('多行新增失败') && state.batchRequests.length===1,'失败反馈保留且不自动重试');
 await key('Escape');check(document.activeElement===field('查看片段 1 的详情'),'失败关闭没有消费父详情来源');
 document.getElementById('result').dataset.state='passed';
}catch(e){document.getElementById('result').dataset.state='failed';document.getElementById('result').textContent=e.stack;}})();
`;
test('关联保存失败关闭子层并保留父层来源',{timeout:40000},t=>{assert.ok(chrome);return checkInteractiveBrowser(t,failedAssociationScript,fixture,1200,800);});

const disconnectedWhileAwayScript=script.slice(0,script.indexOf('\n(async () =>'))+String.raw`
(async()=>{try{
 state.status.snapshot.assets=[{id:'asset',name:'示例.mp4',duration:60}];state.status.snapshot.segments[0].video={assetId:'asset',start:0};
 await act(async()=>{createRoot(document.getElementById('root')).render(<App/>);await settle();});await settle();
 await click(field('查看片段 1 的详情'));await click(button('更改'));
 const parent=layer('画面素材详情'),nativeFrame=window.requestAnimationFrame,nativeCancel=window.cancelAnimationFrame,frames=new Map();let next=0;
 window.requestAnimationFrame=cb=>{const id=--next;frames.set(id,cb);return id;};window.cancelAnimationFrame=id=>{if(id<0)frames.delete(id);else nativeCancel(id);};
 window.dispatchEvent(new Event('blur'));
 await act(async()=>{state.current.disconnect();await settle();});await settle();
 check(!layer('关联视频') && !state.current,'离开期间断连仍按业务规则关闭编辑层');
 const active=document.activeElement;
 window.dispatchEvent(new Event('focus'));window.requestAnimationFrame=nativeFrame;window.cancelAnimationFrame=nativeCancel;
 await act(async()=>{const batch=[...frames.values()];frames.clear();for(const cb of batch)cb(performance.now());await settle();});await settle();
 check(document.activeElement===active,'返回面板不补执行离开期间产生的旧子返回');
 await click(button('关闭详情'));check(document.activeElement===field('查看片段 1 的详情'),'离开取消子恢复不丢失仍存续父来源');
 document.getElementById('result').dataset.state='passed';
}catch(e){document.getElementById('result').dataset.state='failed';document.getElementById('result').textContent=e.stack;}})();
`;
test('离开面板期间断连关闭子层不重放旧返回',{timeout:40000},t=>{assert.ok(chrome);return checkInteractiveBrowser(t,disconnectedWhileAwayScript,fixture,1200,800);});

const keyboardChildrenScript=script.slice(0,script.indexOf('\n(async () =>'))+String.raw`
(async()=>{try{
 state.status.snapshot.assets=[{id:'asset',name:'示例.mp4',duration:60}];state.status.snapshot.segments=['a','b'].map((id,i)=>({id,order:i+1,text:id,video:{assetId:'asset',start:0}}));
 await act(async()=>{createRoot(document.getElementById('root')).render(<App/>);await settle();});await settle();
 field('查看片段 1 的详情').focus();await key('Enter');const parent=layer('画面素材详情');check(parent,'键盘打开父详情');
 const history=button('保留音频');history.focus();await key('Enter');check(field('保留音频')?.contains(document.activeElement),'键盘打开父内配音历史');
 await key('Escape');check(document.activeElement===history,'键盘关闭历史回父层原入口');
 const association=button('更改');association.focus();await key('Enter');check(layer('关联视频')?.contains(document.activeElement),'键盘打开父内关联视频');
 await key('Escape');check(document.activeElement===association && !state.current,'键盘取消关联释放修改权并回父层原入口');
 await key('Escape');check(document.activeElement===field('查看片段 1 的详情'),'两个子流程结束后父来源仍可返回');
 await key('ArrowDown');check(document.activeElement.closest('[row-id]')?.getAttribute('row-id')==='b','连续键盘关闭后继续真实表格方向导航');
 check(!state.saves && !state.mutations.length,'键盘查看和取消不产生业务写入');
 document.getElementById('result').dataset.state='passed';
}catch(e){document.getElementById('result').dataset.state='failed';document.getElementById('result').textContent=e.stack;}})();
`;
test('父详情内历史与关联的完整键盘返回链',{timeout:40000},t=>{assert.ok(chrome);return checkInteractiveBrowser(t,keyboardChildrenScript,fixture,1200,800);});

const failedAssociationNewLayerScript=script.slice(0,script.indexOf('\n(async () =>'))+String.raw`
(async()=>{try{
 state.status.snapshot.assets=[{id:'asset',name:'示例.mp4',duration:60}];state.status.snapshot.segments=['a','b'].map((id,i)=>({id,order:i+1,text:id,visualNote:'',video:{assetId:'asset',start:0}}));
 await act(async()=>{createRoot(document.getElementById('root')).render(<App/>);await settle();});await settle();
 await click(button('查找'));await key('x');
 await click(field('查看片段 1 的详情'));const parent=layer('画面素材详情');await click(button('更改'));
 const vertical=document.querySelector('.ag-body-vertical-scroll-viewport'),nativeFrame=window.requestAnimationFrame,nativeCancel=window.cancelAnimationFrame,frames=new Map();let next=0;
 window.requestAnimationFrame=cb=>{const id=--next;frames.set(id,cb);return id;};window.cancelAnimationFrame=id=>{if(id<0)frames.delete(id);else nativeCancel(id);};
 state.batchFailure=true;await click(button('保存关联与起点'));
 check(!layer('关联视频') && !state.current && document.body.textContent.includes('多行新增失败'),'关联失败实际关闭并释放，保留错误反馈');
 window.requestAnimationFrame=nativeFrame;window.cancelAnimationFrame=nativeCancel;
 await act(async()=>{await window.browserInput({click:'button[aria-haspopup="dialog"]'});await settle();});await settle();
 const active=document.activeElement,newer=active.closest('[role="dialog"][aria-modal="true"]'),scroll=vertical.scrollTop;
 const selected=[...document.querySelectorAll('.ag-row-selected')].map(row=>row.getAttribute('row-id')).join(),data=JSON.stringify(state.status.snapshot.segments);
 check(newer?.querySelector('h2')?.textContent==='更多操作' && newer.contains(active),'用户新模态层已拥有焦点');
 window.requestAnimationFrame=nativeFrame;window.cancelAnimationFrame=nativeCancel;
 await act(async()=>{const batch=[...frames.values()];frames.clear();for(const cb of batch)cb(performance.now());await settle();});await settle();
 check(document.activeElement===active && newer.contains(active) && vertical.scrollTop===scroll,'旧失败返回不得穿透新最上层或滚动');
 check(field('查找文案').value==='x' && layer('画面素材详情')===parent,'旧失败保留查找与仍存续父详情');
 check([...document.querySelectorAll('.ag-row-selected')].map(row=>row.getAttribute('row-id')).join()===selected && JSON.stringify(state.status.snapshot.segments)===data && state.batchRequests.length===1,'选中与数据保持且失败不重试');
 await key('Escape');check(parent.isConnected,'关闭新层不丢失原父流程');
 await click(button('关闭详情'));check(document.activeElement===field('查看片段 1 的详情'),'父流程最终关闭仍回自己的来源');
 await key('ArrowDown');check(document.activeElement.closest('[row-id]')?.getAttribute('row-id')==='b','失败跨链后仍可继续表格方向导航');
 document.getElementById('result').dataset.state='passed';
}catch(e){document.getElementById('result').dataset.state='failed';document.getElementById('result').textContent=e.stack;}})();
`;
test('关联失败关闭待返回时新模态层与父来源仍受保护',{timeout:40000},t=>{assert.ok(chrome);return checkInteractiveBrowser(t,failedAssociationNewLayerScript,fixture,1200,800);});
