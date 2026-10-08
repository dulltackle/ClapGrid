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
const layer = label => document.querySelector('[role="dialog"][aria-label="'+label+'"]');
const click = async n => { await act(async () => { check(n && !n.disabled, '入口可用'); n.focus(); n.click(); await settle(); }); await settle(); };
const key = async (key, shift = false) => { await act(async () => { await window.browserInput({key, shift}); await settle(); }); await settle(); };
const poll = async () => { await act(async () => { [...timers.values()].forEach(f => f()); await settle(); }); await settle(); };
const input = async (n, value) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,value); n.dispatchEvent(new Event('input',{bubbles:true})); await settle(); }); };
const geometry = async (d, name) => {
 const r = d.getBoundingClientRect(); check(r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, '浮层位于视口');
 check(d.scrollWidth <= d.clientWidth, '无横向溢出'); assertTheme('dialog',d);
 for (const n of d.querySelectorAll('input,select')) assertTheme('form',n);
 for (const n of d.querySelectorAll('button')) assertTheme('cancel',n);
 for (const n of d.querySelectorAll('button,input,select,video')) { n.scrollIntoView({block:'nearest'}); const b=n.getBoundingClientRect(); check(b.top >= r.top && b.bottom <= r.bottom, '控件可滚动到达'); }
 await window.browserInput({screenshot: name+'-'+innerHeight});
};
(async () => { try {
 state.status.snapshot.assets = [{id:'asset',name:'示例素材.mp4',duration:60}];
 state.status.snapshot.segments[0].video = {assetId:'asset',start:2};
 await act(async () => { createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>); await settle(); }); await settle();
 await click(button('详情')); const parent=layer('画面素材详情'); check(parent, '素材详情采用统一模态语义'); await geometry(parent,'details');
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
 state.acquireGate=deferred(); await click(button('详情')); await click(button('更改')); await key('Escape');
 await click(button('查找')); const search=field('查找文案'); search.focus();
 await act(async()=>{state.acquireGate.resolve();state.acquireGate=null;await settle();}); await settle();
 check(!layer('关联视频') && document.activeElement===search && !state.current,'等待修改权后已转移操作不重开抢焦点并释放旧修改权');
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
 await poll(); await click(button('详情')); await click(button('播放预览')); state.status.snapshot.segments=[]; await poll(); await key('Escape');
 check(layer('画面素材详情').contains(document.activeElement) && layer('画面素材详情').textContent.includes('口播片段已不存在'),'片段删除后关闭嵌套层仍回详情');
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
