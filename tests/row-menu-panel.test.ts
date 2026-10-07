import { test } from 'node:test';
import { chrome } from './helpers/browser.js';
import { fixture } from './helpers/editing-fixture.js';
import { checkInteractiveBrowser } from './helpers/interactive-browser.js';
const script = String.raw`
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './src/panel/app.tsx';
import { state } from 'editing-fixture';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const timers = new Map(); let timer = 0;
window.setInterval = cb => { timers.set(++timer, cb); return timer; }; window.clearInterval = id => timers.delete(id);
const action = async cb => { await act(async () => { await cb(); await new Promise(r => setTimeout(r, 80)); }); await new Promise(r => setTimeout(r, 150)); };
const input = request => action(() => window.browserInput(request));
const check = (v, m) => { if (!v) throw Error(m); };
const menu = () => document.querySelector('[role="menu"][aria-label="口播片段操作"]');
const dialog = () => document.querySelector('[role="alertdialog"]');
const right = id => input({click: '[row-id="'+id+'"] [col-id="text"]', button:'right'});
const bounds = node => { const r = node.getBoundingClientRect(); check(r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, '浮层不越界'); };
(async () => { try {
state.status.snapshot.segments = ['a','b','c'].map((id,i)=>({id,order:i+1,text:id,video:null}));
await action(()=>createRoot(document.getElementById('root')).render(<App/>));
await input({click:'[row-id="a"] input[type="checkbox"]'});
await input({click:'[row-id="b"] input[type="checkbox"]'});
await right('a'); check(menu(), '右键打开行菜单'); bounds(menu()); check(getComputedStyle(menu()).backgroundColor === 'rgb(255, 255, 255)', '菜单采用主题不透明背景'); check(document.activeElement === menu(), '鼠标打开聚焦菜单容器，方向键进入选项'); await window.browserInput({screenshot:'row-menu'});
check(state.selectionRequests.at(-1).join() === 'a,b', '右键已选行保留集合');
await input({key:'ArrowDown'}); await input({key:'Enter'}); check(dialog()?.textContent.includes('确定删除已勾选的 2 个口播片段？'), '多选范围明确'); bounds(dialog()); await window.browserInput({screenshot:'delete-confirm'});
check(document.getElementById(dialog().getAttribute('aria-labelledby')).textContent === '删除口播片段', '确认有可访问名称');
check(getComputedStyle(dialog()).borderTopColor === 'rgb(227, 228, 231)', '确认边框沿用主题浅灰');
const controls = [...dialog().querySelectorAll('button')];
const cancel = controls.find(node => node.textContent === '取消'), confirm = controls.find(node => node.textContent === '删除');
check(cancel && confirm && !cancel.disabled && !confirm.disabled, '取消与删除保留清晰名称及原生按钮语义');
check(getComputedStyle(confirm).backgroundColor === 'rgb(164, 38, 44)' && getComputedStyle(confirm).color === 'rgb(255, 255, 255)', '危险操作使用现有错误色和清晰白字');
for (const control of [cancel, confirm]) { bounds(control); check(control.getBoundingClientRect().height >= 32, '按钮具有可用点击高度'); }
check(getComputedStyle(cancel).backgroundColor === 'rgb(255, 255, 255)' && getComputedStyle(cancel).borderTopWidth === '1px', '取消保持亮色边框样式');
const legacy = [...document.querySelectorAll('header button')].find(node => node.textContent === '更多');
check(getComputedStyle(legacy).borderTopWidth === '1px' && getComputedStyle(legacy).paddingLeft === (innerWidth <= 600 ? '8px' : '12px'), '非试点按钮原有样式保留');
const textCell = document.querySelector('[row-id="a"] [col-id="text"]');
const textRect = textCell.querySelector('.text-summary').getBoundingClientRect(), cellRect = textCell.getBoundingClientRect();
check(getComputedStyle(textCell).display === 'flex' && Math.abs(textRect.top + textRect.height / 2 - cellRect.top - cellRect.height / 2) <= 1, '文案单元格保留垂直居中的弹性布局');
check(getComputedStyle(document.querySelector('.grid')).display === 'block', '表格容器保持原有块布局，不被同名工具类覆盖');
check(document.querySelector('[row-id="a"] [col-id="text"]').getBoundingClientRect().height > 20, '真实表格行布局保持可用');
check(!state.batchRequests, '尚未提交');
check(document.activeElement === cancel, '默认聚焦安全的取消按钮');
await input({key:'Tab'}); check(document.activeElement === confirm, 'Tab 到确认');
await input({key:'Tab'}); check(document.activeElement === cancel, 'Tab 环绕');
await input({key:'Tab',shift:true}); check(document.activeElement === confirm, 'Shift Tab 环绕');
await input({key:'Tab'});
await input({key:'Enter'}); check(!dialog() && state.selectionRequests.at(-1).join() === 'a,b', '取消保留勾选');
await right('c'); check(state.selectionRequests.at(-1).join() === 'c', '右键未选行替换集合');
await input({key:'ArrowDown'}); await input({key:'Enter'}); check(dialog().textContent.includes('确定删除这个口播片段？'), '单选提示');
await input({key:'Escape'}); check(!dialog() && state.selectionRequests.at(-1).join() === 'c', 'Escape仅关弹窗');
await right('c'); await input({key:'Escape'}); check(!menu() && state.selectionRequests.at(-1).join() === 'c', 'Escape仅关菜单');
await right('c'); await input({key:'ArrowDown'}); await input({key:'Enter'});
await input({click:'[role="alertdialog"] [data-delete-confirm]'});
check(state.batchRequests.at(-1).changes[0].expected.id === 'c', '明确确认提交固定目标');
await action(() => new Promise(r => setTimeout(r, 400)));
check(!document.querySelector('[row-id="c"]'), '删除结果更新表格');
await input({click:'.grid',button:'right'}); check(!menu(), '空白无隐含行目标');
document.getElementById('result').dataset.state='passed';
} catch(e) { document.getElementById('result').dataset.state='failed'; document.getElementById('result').textContent=e.stack; }})();
`;
for (const width of [1600, 420]) test(`行右键删除确认的真实输入与视口（${width}px）`, {skip: chrome ? false : '需要 Chrome',timeout:40000}, t=>checkInteractiveBrowser(t,script,fixture,width));

const raceScript = script.slice(0, script.indexOf('\n(async () =>')) + String.raw`
(async () => { try {
state.status.snapshot.segments = ['a','b','c'].map((id,i)=>({id,order:i+1,text:id,video:null}));
await action(()=>createRoot(document.getElementById('root')).render(<App/>));
await input({click:'[row-id="a"] input[type="checkbox"]'});
await input({click:'[row-id="b"] input[type="checkbox"]'});
await right('a'); await input({key:'ArrowDown'}); await input({key:'Enter'});
const original = structuredClone(state.status.snapshot.segments.slice(0,2));
// 通过后台连接断开清空勾选，弹窗目标仍固定。
await action(()=>state.tableConnections.at(-1).resolve());
state.status.snapshot.segments[0].text = '其他访问端的新内容';
state.status.snapshot.segments.splice(1,1);
await action(()=>[...timers.values()].forEach(cb=>cb()));
check(dialog().textContent.includes('2 个'), '刷新和断线不改变固定范围');
await input({click:'[role="alertdialog"] [data-delete-confirm]'});
check(JSON.stringify(state.batchRequests.at(-1).changes.map(c=>c.expected)) === JSON.stringify(original), '提交完整旧快照，不以新内容覆盖旧目标');
check(document.querySelector('footer').textContent.includes('口播片段内容已变化') && document.querySelector('footer').textContent.includes('口播片段已删除'), '逐项反馈变更与删除');
check(document.querySelector('[row-id="a"]').textContent.includes('其他访问端的新内容'), '新内容仍可见');
check(state.batchRequests.length === 1, '无自动重试');
await action(()=>[...timers.values()].forEach(cb=>cb()));
await right('a'); check(menu() && menu().querySelector('[role="menuitem"]').getAttribute('aria-disabled') !== 'true', '再次菜单可用：'+document.querySelector('main').textContent); await input({key:'ArrowDown'}); await input({key:'Enter'});
check(dialog(), '再次弹窗打开：'+document.activeElement?.outerHTML);
for (const lock of ['task', 'speech', 'codex', 'user']) {
state.status.taskLocked = lock === 'task';
state.speech = {locked:lock === 'speech', voice:{speaker:'zh_female_vv_uranus_bigtts',speechRate:0},tasks:[],operations:[],audio:[]};
state.status.modification = ['codex','user'].includes(lock) ? {owner:lock} : null;
await action(()=>[...timers.values()].forEach(cb=>cb()));
check(document.querySelector('[data-delete-confirm]').disabled, '弹窗期间共享锁阻止确认：'+lock);
await input({click:'[role="alertdialog"] [data-delete-confirm]'}); check(state.batchRequests.length === 1, '锁定不提交');
}
await input({key:'Escape'}); check(!dialog(), '锁定仍可取消');
state.status.modification=null; state.speech.locked=false;
await action(()=>[...timers.values()].forEach(cb=>cb()));
await right('a'); await input({key:'ArrowDown'}); await input({key:'Enter'});
// 未轮询到的占用也必须重新申请修改权；服务拒绝显示反馈。
state.current = {};
await input({click:'[role="alertdialog"] [data-delete-confirm]'});
check(state.batchRequests.length === 1 && document.querySelector('footer').textContent.includes('用户正在编辑'), '确认时重新申请修改权');
document.getElementById('result').dataset.state='passed';
} catch(e) { document.getElementById('result').dataset.state='failed'; document.getElementById('result').textContent=e.stack; }})();
`;
const raceFixture = fixture.replace(
  "if (change.kind === 'delete') state.status.snapshot.segments = state.status.snapshot.segments.filter(item => item.id !== change.expected.id);",
  "if (change.kind === 'delete') { const current = state.status.snapshot.segments.find(item => item.id === change.expected.id); if (JSON.stringify(current) === JSON.stringify(change.expected)) state.status.snapshot.segments = state.status.snapshot.segments.filter(item => item.id !== change.expected.id); }",
).replace("results: [] };", "results: batch.changes.map((change,index) => ({ index, outcome: index ? 'deleted' : 'changed', message: index ? '口播片段已删除，已跳过' : '口播片段内容已变化，已跳过' })) };");
test('确认删除保持旧快照并反馈过时目标，动态任务锁及修改权阻止提交', {skip:chrome ? false:'需要 Chrome',timeout:40000}, t=>checkInteractiveBrowser(t,raceScript,raceFixture));

const edgeScript = script.slice(0, script.indexOf('\n(async () =>')) + String.raw`
(async () => { try {
state.status.snapshot.segments = Array.from({length:30},(_,i)=>({id:'s'+i,order:i+1,text:'片段 '+i,video:null}));
await action(()=>createRoot(document.getElementById('root')).render(<App/>));
await input({pointer:{type:'mouseWheel',selector:'.ag-grid-viewport',deltaY:500}});
const viewport = document.querySelector('.ag-body-vertical-scroll-viewport');
const horizontal = document.querySelector('.ag-body-horizontal-scroll-viewport');
const scroll = () => [viewport.scrollTop,horizontal.scrollLeft].join();
const rect = document.querySelector('.ag-grid-viewport').getBoundingClientRect();
const lastVisible = [...document.querySelectorAll('[row-id]')].filter(node => {const r=node.getBoundingClientRect();return r.top>=rect.top && r.bottom<=rect.bottom;}).at(-1);
check(lastVisible, '窄高视口仍有完整可见行');
const point = {x:Math.min(innerWidth-28,rect.right-28),y:lastVisible.getBoundingClientRect().bottom-8};
const target = document.elementFromPoint(point.x,point.y).closest('[row-id]');
check(target, '边缘真实命中口播片段');
const id = target.getAttribute('row-id'), before = scroll();
await input({pointer:{type:'mousePressed',...point},button:'right'});
await input({pointer:{type:'mouseReleased',...point},button:'right'});
check(menu(), '右下边缘打开菜单');bounds(menu());
check(state.selectionRequests.at(-1).join()===id,'边缘范围采用实际行');
for (const [key,label] of [['End','下方添加'],['ArrowUp','上方添加'],['Home','删除口播片段'],['ArrowDown','上方添加'],['Home','删除口播片段']]) {
 await input({key}); check(document.activeElement.textContent===label,'原语键盘导航 '+key);
}
await input({key:' '});check(dialog() && dialog().contains(document.activeElement),'Space 打开确认，菜单关闭不抢走焦点'); bounds(dialog());
for(const node of dialog().querySelectorAll('button')) bounds(node);
await input({key:'Escape'});check(!dialog() && !menu(),'Escape 关闭确认');
check(document.activeElement.closest('[row-id]')?.getAttribute('row-id')===id,'关闭返回稳定口播片段');
check(scroll()===before,'正常关闭保持表格滚动');
await input({pointer:{type:'mousePressed',...point},button:'right'});
await input({pointer:{type:'mouseReleased',...point},button:'right'});
await input({key:'Escape'});check(!menu() && scroll()===before,'菜单 Escape 保持滚动');
await window.browserInput({screenshot:'menu-edge-return'});
document.getElementById('result').dataset.state='passed';
} catch(e) { document.getElementById('result').dataset.state='failed'; document.getElementById('result').textContent=e.stack; }})();
`;
for (const width of [1600,420]) test(`行菜单边缘定位、全部导航键及 Space 焦点交接（${width}×360）`, {skip:chrome?false:'需要 Chrome',timeout:40000},t=>checkInteractiveBrowser(t,edgeScript,fixture,width,360));

const focusScript = script.slice(0, script.indexOf('\n(async () =>')).replace("import { state }", "import { state, deferred }") + String.raw`
(async () => { try {
state.status.snapshot.segments = Array.from({length:60},(_,i)=>({id:'s'+i,order:i+1,text:'keep '+i,video:null}));
await action(()=>createRoot(document.getElementById('root')).render(<App/>));
const poll = () => action(()=>[...timers.values()].forEach(cb=>cb()));
const open = async id => { await right(id); await input({key:'ArrowDown'}); await input({key:'Enter'}); check(dialog()?.contains(document.activeElement),'焦点进入确认'); };
const focused = () => document.activeElement.closest('[row-id]')?.getAttribute('row-id');
await open('s1');
// 共享状态重排使原行离开虚拟窗口，关闭后按稳定身份重新定位。
state.status.snapshot.segments.push(state.status.snapshot.segments.splice(1,1)[0]);
state.status.snapshot.segments.forEach((s,i)=>s.order=i+1);
await poll(); await action(()=>new Promise(r=>setTimeout(r,500)));
check(!document.querySelector('[row-id="s1"]'),'轮询使来源 DOM 离开虚拟窗口');
await input({key:'Escape'}); check(focused()==='s1','虚拟滚动恢复稳定来源身份：'+document.activeElement.outerHTML+' source='+document.querySelector('[row-id="s1"]')?.outerHTML+' scroll='+document.querySelector('.ag-body-vertical-scroll-viewport').scrollTop);
await open('s1');
state.saveGate = deferred();
await input({click:'[role="alertdialog"] [data-delete-confirm]'});
check(dialog() && document.activeElement.textContent==='取消','等待响应时保持安全焦点且不可重复提交');
await input({key:'Tab'}); check(document.activeElement.textContent==='取消','等待响应只保留取消键盘路径');
await action(()=>state.saveGate.resolve()); state.saveGate=null;
check(!dialog() && focused()==='s59','删除最后行响应落地后回到相邻行');
await input({key:'ArrowUp'}); check(focused()==='s58','删除后键盘仍可操作表格');
// 共享状态删除所有行时使用表格后备入口。
await poll(); await open('s58'); state.status.snapshot.segments=[]; await poll();
await input({key:'Escape'}); check(document.activeElement.textContent==='更多','空表恢复可见后备入口');
check(state.batchRequests.length===1,'取消及轮询没有额外删除');
document.getElementById('result').dataset.state='passed';
} catch(e) { document.getElementById('result').dataset.state='failed'; document.getElementById('result').textContent=e.stack; }})();
`;
test('删除响应、轮询重排、虚拟滚动与空表后备焦点', {skip:chrome?false:'需要 Chrome',timeout:40000},t=>checkInteractiveBrowser(t,focusScript,fixture));

const failureScript = script.slice(0, script.indexOf('\n(async () =>')) + String.raw`
(async () => { try {
state.status.snapshot.segments=['a','b'].map((id,i)=>({id,order:i+1,text:id,video:null}));
await action(()=>createRoot(document.getElementById('root')).render(<App/>));
await right('a'); await input({key:'ArrowDown'}); await input({key:'Enter'});
await input({click:'[role="alertdialog"] [data-delete-confirm]'});
check(!dialog() && document.querySelector('footer').textContent.includes('删除结果不可确认'),'失败反馈且退出确认');
await action(()=>[...timers.values()].forEach(cb=>cb()));
await action(()=>new Promise(r=>setTimeout(r,400)));
check(state.batchRequests.length===1,'失败或未知结果不得自动重试');
document.getElementById('result').dataset.state='passed';
} catch(e) { document.getElementById('result').dataset.state='failed'; document.getElementById('result').textContent=e.stack; }})();
`;
for (const unknown of [false,true]) test(`删除${unknown?'已处理但响应未知':'请求失败'}不自动重试`,{skip:chrome?false:'需要 Chrome',timeout:40000},t=>checkInteractiveBrowser(t,failureScript,fixture.replace(unknown?'if (state.saveGate) await state.saveGate.promise;\n    return result;\n  }\n  export async function submitExport':'if (state.batchFailure) throw Error(\'多行新增失败\');',unknown?'throw Error("删除结果不可确认");\n    return result;\n  }\n  export async function submitExport':'throw Error("删除结果不可确认");')));

const filterScript = script.slice(0, script.indexOf('\n(async () =>')) + String.raw`
(async () => { try {
state.status.snapshot.segments=['a','b','c'].map((id,i)=>({id,order:i+1,text:id,video:null}));
await action(()=>createRoot(document.getElementById('root')).render(<App/>));
await input({click:'.search-trigger'}); await input({key:'a'});
await right('a'); await input({key:'ArrowDown'}); await input({key:'Enter'});
state.status.snapshot.segments[0].text='changed';
await action(()=>[...timers.values()].forEach(cb=>cb()));
await input({key:'Escape'});
check(document.querySelector('[aria-label="查找文案"]').value==='a','取消保留查找条件');
check(document.activeElement.closest('[row-id]')?.getAttribute('row-id')==='a','查找变化后仍返回稳定片段');
await right('b'); await input({key:'ArrowDown'}); await input({key:'Enter'});
await input({key:'Tab'}); check(document.activeElement.textContent==='删除','先聚焦确认');
state.status.taskLocked=true; await action(()=>[...timers.values()].forEach(cb=>cb()));
check(document.activeElement.textContent==='取消','确认动态禁用后焦点移到可用取消');
await input({key:'Enter'}); check(!dialog() && !state.batchRequests,'锁定时取消仍可执行');
document.getElementById('result').dataset.state='passed';
} catch(e) { document.getElementById('result').dataset.state='failed'; document.getElementById('result').textContent=e.stack; }})();
`;
test('查找状态与确认动态禁用保持可用焦点', {skip:chrome?false:'需要 Chrome',timeout:40000},t=>checkInteractiveBrowser(t,filterScript,fixture));

const pendingCancelScript = script.slice(0, script.indexOf('\n(async () =>')).replace("import { state }", "import { state, deferred }") + String.raw`
(async () => { try {
state.status.snapshot.segments=['a','b','c'].map((id,i)=>({id,order:i+1,text:id,video:null}));
await action(()=>createRoot(document.getElementById('root')).render(<App/>));
await right('a'); await input({key:'ArrowDown'}); await input({key:'Enter'});
state.saveGate=deferred(); await input({click:'[role="alertdialog"] [data-delete-confirm]'});
await input({key:'Escape'}); check(!dialog(),'等待已发出的请求期间仍可关闭确认');
await input({click:'.search-trigger'}); await input({key:'b'});
const search=document.querySelector('[aria-label="查找文案"]'); check(document.activeElement===search,'用户已转向查找');
await action(()=>state.saveGate.resolve()); state.saveGate=null;
check(document.activeElement===search && search.value==='b','迟到响应不抢用户新焦点');
check(state.batchRequests.length===1 && !dialog(),'已确认请求仅执行一次，不重新打开弹窗');
document.getElementById('result').dataset.state='passed';
} catch(e) { document.getElementById('result').dataset.state='failed'; document.getElementById('result').textContent=e.stack; }})();
`;
test('等待删除响应时取消不撤回已发送请求且不抢新焦点', {skip:chrome?false:'需要 Chrome',timeout:40000},t=>checkInteractiveBrowser(t,pendingCancelScript,fixture));

const pendingReturnScript = pendingCancelScript
  .replace("await input({click:'.search-trigger'}); await input({key:'b'});\nconst search=document.querySelector('[aria-label=\"查找文案\"]'); check(document.activeElement===search,'用户已转向查找');", "check(document.activeElement.closest('[row-id]')?.getAttribute('row-id')==='a','取消先返回原片段');")
  .replace("check(document.activeElement===search && search.value==='b','迟到响应不抢用户新焦点');", "check(document.activeElement.closest('[row-id]')?.getAttribute('row-id')==='b','迟到删除移除当前焦点后恢复相邻片段');");
test('等待响应取消后留在原片段，迟到删除仍恢复相邻行', {skip:chrome?false:'需要 Chrome',timeout:40000},t=>checkInteractiveBrowser(t,pendingReturnScript,fixture));
