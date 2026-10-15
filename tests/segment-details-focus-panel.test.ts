import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chrome } from './helpers/browser.js';
import { fixture } from './helpers/editing-fixture.js';
import { checkInteractiveBrowser } from './helpers/interactive-browser.js';

const setup = String.raw`
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './src/panel/app.tsx';
import { state, deferred } from 'editing-fixture';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const timers = new Map(); let timer = 0;
window.setInterval = callback => { timers.set(++timer, callback); return timer; }; window.clearInterval = id => timers.delete(id);
const check = (value, message) => { if (!value) throw Error(message); };
const settle = () => new Promise(resolve => setTimeout(resolve, 70));
const action = async callback => { await act(async () => { await callback(); await settle(); }); await settle(); };
const button = name => [...document.querySelectorAll('button')].find(node => node.textContent === name || node.getAttribute('aria-label') === name);
const click = name => action(() => { const node = button(name); check(node && !node.disabled, '入口可用：' + name); node.focus(); node.click(); });
const key = key => action(() => window.browserInput({ key }));
const open = order => click('查看片段 '+order+' 的详情');
const field = name => document.querySelector('[aria-label="详情'+name+'"]');
const input = async (name, value) => { await action(() => window.browserInput({click:'[aria-label="详情'+name+'"]'})); await action(() => { const node=field(name); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(node,value); node.dispatchEvent(new Event('input',{bubbles:true})); }); };
const focused = () => document.activeElement.closest('[row-id]')?.getAttribute('row-id');
const poll = () => action(() => [...timers.values()].forEach(callback => callback()));
const mount = () => action(() => { state.status.snapshot.segments=[{id:'a',order:1,text:'片段 A',visualNote:'说明 A',video:null},{id:'b',order:2,text:'片段 B',visualNote:'说明 B',video:null},{id:'c',order:3,text:'片段 C',visualNote:'说明 C',video:null}]; createRoot(document.getElementById('root')).render(<App/>); });
`;
function page(name: string, body: string) {
  test(name, {timeout: 40000}, t => {
    assert.ok(chrome, '必须实际启动 Chrome 验证详情焦点');
    return checkInteractiveBrowser(t, setup + `(async()=>{try { await mount(); ${body} document.getElementById('result').dataset.state='passed'; } catch(error) {document.getElementById('result').dataset.state='failed';document.getElementById('result').textContent=error.stack;} })();`, fixture, 1200, 800);
  });
}
page('详情取消表格导航保留原来源和原文案字段', String.raw`
 await open(1); await input('文案','A 草稿'); await open(2);
 check(document.querySelector('[role="alertdialog"]'),'草稿拦住导航');
 await click('继续编辑'); check(document.activeElement===field('文案') && field('文案').value==='A 草稿','继续编辑回文案并保留草稿');
 await click('关闭详情'); await click('放弃修改');
 check(focused()==='a' && document.activeElement.hasAttribute('data-row-details'),'取消导航没有覆盖 A 来源');
 await key('ArrowDown'); check(focused()==='b','回详情入口后真实方向键继续表格导航');
`);
page('继续编辑的延迟返回不能覆盖新的查找操作', String.raw`
 await open(1); await input('画面说明','A 说明草稿'); await open(2);
 const nativeFrame=window.requestAnimationFrame, nativeCancel=window.cancelAnimationFrame, callbacks=new Map(); let frame=0;
 window.requestAnimationFrame=callback=>{const id=--frame;callbacks.set(id,callback);return id;};
 window.cancelAnimationFrame=id=>{if(id<0)callbacks.delete(id);else nativeCancel(id);};
 await click('继续编辑');
 await action(async()=>{const rect=button('查找').getBoundingClientRect();for(const type of ['mousePressed','mouseReleased']) await window.browserInput({pointer:{type,x:rect.x+rect.width/2,y:rect.y+rect.height/2}});});
 const search=document.querySelector('[aria-label="查找文案"]');
 window.requestAnimationFrame=nativeFrame;window.cancelAnimationFrame=nativeCancel;
 await action(()=>{const batch=[...callbacks.values()];callbacks.clear();for(const callback of batch)callback(performance.now());});
 check(document.activeElement===search,'继续编辑的旧返回不抢新查找焦点');
 check(field('画面说明').value==='A 说明草稿','取消待执行返回仍保留抽屉草稿');
 await click('关闭详情'); await click('放弃修改');
 check(focused()==='a','父抽屉以后真正关闭仍持有 A 来源');
`);
page('保存继续期间的新操作取消迟到导航与来源提交', String.raw`
 await open(1); await input('文案','保存的 A'); await open(2);
 state.saveGate=deferred(); await click('保存并继续');
 await key('Tab');
 await action(()=>{state.saveGate.resolve();state.saveGate=null;});
 check(state.status.snapshot.segments[0].text==='保存的 A','有效保存结果仍被接收');
 check(field('文案').value==='保存的 A','新的键盘操作后迟到保存不接续旧 B 导航');
 await click('关闭详情'); check(focused()==='a','未执行的 B 导航没有替换 A 来源');
`);
page('详情导航后的延迟初始聚焦尊重新操作且来源仍能正常关闭', String.raw`
 await open(1);
 const nativeFrame=window.requestAnimationFrame, nativeCancel=window.cancelAnimationFrame, callbacks=new Map();let frame=0;
 window.requestAnimationFrame=callback=>{const id=--frame;callbacks.set(id,callback);return id;};window.cancelAnimationFrame=id=>{if(id<0)callbacks.delete(id);else nativeCancel(id);};
 await open(2);
 await action(async()=>{const rect=button('查找').getBoundingClientRect();for(const type of ['mousePressed','mouseReleased'])await window.browserInput({pointer:{type,x:rect.x+rect.width/2,y:rect.y+rect.height/2}});});
 const search=document.querySelector('[aria-label="查找文案"]');
 window.requestAnimationFrame=nativeFrame;window.cancelAnimationFrame=nativeCancel;
 await action(()=>{const batch=[...callbacks.values()];callbacks.clear();for(const callback of batch)callback(performance.now());});
 check(document.activeElement===search,'已转向查找后旧初始聚焦不能抢焦点');
 await click('关闭详情');check(focused()==='b','取消旧聚焦不丢弃已成功提交的 B 来源');
`);
page('详情修改权意图离开后返回也永久失效', String.raw`
 await open(1); state.acquireGate=deferred();
 await action(()=>window.browserInput({click:'[aria-label="详情画面说明"]'})); check(state.leases.length===1,'修改权已实际等待');
 await action(async()=>{const rect=button('查找').getBoundingClientRect();for(const type of ['mousePressed','mouseReleased'])await window.browserInput({pointer:{type,x:rect.x+rect.width/2,y:rect.y+rect.height/2}});});
 await action(()=>window.browserInput({click:'aside h2'}));
 await action(()=>document.querySelector('aside').focus());
 const before=document.activeElement;check(before===document.querySelector('aside'),'用户已回到父层容器：'+before.tagName);
 await action(()=>{state.acquireGate.resolve();state.acquireGate=null;});
 check(!state.current && field('画面说明').readOnly && document.activeElement===before,'离开后返回不重新取得旧修改权或聚焦字段');
 await click('关闭详情');check(focused()==='a','迟到编辑取消仍保留抽屉自己的来源');
`);
for (const entry of ['鼠标','键盘']) page(`${entry}详情内部浏览保留来源而表格成功导航提交新来源`, String.raw`
 if ('${entry}'==='鼠标') await action(()=>window.browserInput({click:'[aria-label="查看片段 1 的详情"]'}));
 else {await action(()=>button('查看片段 1 的详情').focus());await key('Enter');}
 await click('下一条片段');check(field('文案').value==='片段 B','内部浏览到 B');
 await click('关闭详情');check(focused()==='a' && document.activeElement.hasAttribute('data-row-details'),'内部 B 关闭仍回 A 入口');
 await key('ArrowDown');check(focused()==='b','从 A 恢复后真实方向键进入 B');
 await open(1);await action(()=>button('查看片段 2 的详情').focus());await key('Enter');
 check(field('文案').value==='片段 B','表格另开 B 实际成功');
 await click('关闭详情');check(focused()==='b','新成功导航关闭回 B');
 await key('ArrowDown');check(focused()==='c','B 来源也同步真实表格方向键位置');
`);
for (const fieldName of ['文案','画面说明']) page(`${fieldName}保存失败保留草稿确认与来源，成功继续才提交 B`, String.raw`
 await open(1);await input('${fieldName}','A 新内容');await open(2);
 state.segmentFailure=true;await click('保存并继续');
 check(document.querySelector('[role="alertdialog"]') && field('${fieldName}').value==='A 新内容' && document.body.textContent.includes('文案保存失败'),'保存失败保留确认、草稿和错误');
 await click('继续编辑');check(document.activeElement===field('${fieldName}'),'继续编辑回原字段');
 await click('关闭详情');await click('放弃修改');check(focused()==='a','保存失败不提交 B 来源');
 state.segmentFailure=false;await open(1);await input('${fieldName}','A 成功内容');await open(2);await click('保存并继续');
 check(!document.querySelector('[role="alertdialog"]') && field('${fieldName}').value==='${fieldName==='文案'?'片段 B':'说明 B'}','保存成功接续业务导航');
 check(state.status.snapshot.segments[0].${fieldName==='文案'?'text':'visualNote'}==='A 成功内容','保存真实数据');
 await click('关闭详情');check(focused()==='b','成功导航后提交 B 来源');
`);
page('详情关闭后新空白点击永久取消旧恢复与滚动', String.raw`
 await open(1);
 const nativeFrame=window.requestAnimationFrame,nativeCancel=window.cancelAnimationFrame,callbacks=new Map();let frame=0;
 window.requestAnimationFrame=callback=>{const id=--frame;callbacks.set(id,callback);return id;};window.cancelAnimationFrame=id=>{if(id<0)callbacks.delete(id);else nativeCancel(id);};
 await click('关闭详情');check(!document.querySelector('aside'),'业务实际关闭抽屉');
 await action(async()=>{for(const type of ['mousePressed','mouseReleased'])await window.browserInput({pointer:{type,x:5,y:5}});});
 const vertical=document.querySelector('.ag-body-vertical-scroll-viewport'),scroll=vertical.scrollTop;
 window.requestAnimationFrame=nativeFrame;window.cancelAnimationFrame=nativeCancel;
 await action(()=>{const batch=[...callbacks.values()];callbacks.clear();for(const callback of batch)callback(performance.now());});
 check(!focused() && vertical.scrollTop===scroll,'旧关闭不得恢复焦点或准备滚动');
 await open(2);await click('关闭详情');check(focused()==='b','新流程拥有独立来源');
`);
page('详情关闭在来源被删除和重排后采用统一稳定身份及显示位置', String.raw`
 await open(1);state.status.snapshot.segments=[state.status.snapshot.segments[1],state.status.snapshot.segments[2],state.status.snapshot.segments[0]];
 await poll();await click('关闭详情');check(focused()==='a','重排后找回稳定 A');await key('ArrowUp');check(focused()==='c','重排后方向键使用现有显示位置');
 await open(3);state.status.snapshot.segments=state.status.snapshot.segments.filter(segment=>segment.id!=='c');await poll();
 await click('关闭详情');check(focused()==='a','删除原来源后取原显示位置当前片段');
 await open(1);state.status.snapshot.segments=[];await poll();await click('关闭详情');check(document.activeElement===button('查找'),'空表沿用页面后备');
`);
page('修改权忙态拒绝新的 B 来源且迟到编辑不会重新取得焦点', String.raw`
 await open(1);state.acquireGate=deferred();
 await action(()=>window.browserInput({click:'[aria-label="详情文案"]'}));check(state.current,'已申请修改权');
 await action(()=>button('查看片段 2 的详情').focus());await key('Enter');
 await action(()=>{state.acquireGate.resolve();state.acquireGate=null;});
 check(field('文案').value==='片段 A' && !state.current,'忙态不导航也不接收已转向的修改权');
 await click('关闭详情');check(focused()==='a','被忙态拒绝的 B 没有覆盖原来源');
`);
