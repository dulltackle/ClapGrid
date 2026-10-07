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
const dialog = () => document.querySelector('dialog[aria-label="删除口播片段"]');
const right = id => input({click: '[row-id="'+id+'"] [col-id="text"]', button:'right'});
const bounds = node => { const r = node.getBoundingClientRect(); check(r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, '浮层不越界'); };
(async () => { try {
state.status.snapshot.segments = ['a','b','c'].map((id,i)=>({id,order:i+1,text:id,video:null}));
await action(()=>createRoot(document.getElementById('root')).render(<App/>));
await input({click:'[row-id="a"] input[type="checkbox"]'});
await input({click:'[row-id="b"] input[type="checkbox"]'});
await right('a'); check(menu(), '右键打开行菜单'); bounds(menu()); await window.browserInput({screenshot:'row-menu'});
check(state.selectionRequests.at(-1).join() === 'a,b', '右键已选行保留集合');
await input({key:'Enter'}); check(dialog()?.textContent.includes('确定删除已勾选的 2 个口播片段？'), '多选范围明确'); bounds(dialog()); await window.browserInput({screenshot:'delete-confirm'});
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
await input({key:'Tab'}); check(document.activeElement.textContent === '取消', '默认键盘路径先到取消');
await input({key:'Enter'}); check(!dialog() && state.selectionRequests.at(-1).join() === 'a,b', '取消保留勾选');
await right('c'); check(state.selectionRequests.at(-1).join() === 'c', '右键未选行替换集合');
await input({key:'Enter'}); check(dialog().textContent.includes('确定删除这个口播片段？'), '单选提示');
await input({key:'Escape'}); check(!dialog() && state.selectionRequests.at(-1).join() === 'c', 'Escape仅关弹窗');
await right('c'); await input({key:'Escape'}); check(!menu() && state.selectionRequests.at(-1).join() === 'c', 'Escape仅关菜单');
await right('c'); await input({key:'Enter'});
await input({click:'dialog [data-delete-confirm]'});
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
await right('a'); await input({key:'Enter'});
const original = structuredClone(state.status.snapshot.segments.slice(0,2));
// 通过后台连接断开清空勾选，弹窗目标仍固定。
await action(()=>state.tableConnections.at(-1).resolve());
state.status.snapshot.segments[0].text = '其他访问端的新内容';
state.status.snapshot.segments.splice(1,1);
await action(()=>[...timers.values()].forEach(cb=>cb()));
check(dialog().textContent.includes('2 个'), '刷新和断线不改变固定范围');
await input({click:'dialog [data-delete-confirm]'});
check(JSON.stringify(state.batchRequests.at(-1).changes.map(c=>c.expected)) === JSON.stringify(original), '提交完整旧快照，不以新内容覆盖旧目标');
check(document.querySelector('footer').textContent.includes('口播片段内容已变化') && document.querySelector('footer').textContent.includes('口播片段已删除'), '逐项反馈变更与删除');
check(document.querySelector('[row-id="a"]').textContent.includes('其他访问端的新内容'), '新内容仍可见');
check(state.batchRequests.length === 1, '无自动重试');
await action(()=>[...timers.values()].forEach(cb=>cb()));
await right('a'); check(menu() && !menu().querySelector('button').disabled, '再次菜单可用：'+document.querySelector('main').textContent); await input({key:'Enter'});
check(dialog(), '再次弹窗打开：'+document.activeElement?.outerHTML);
for (const lock of ['task', 'speech', 'codex', 'user']) {
state.status.taskLocked = lock === 'task';
state.speech = {locked:lock === 'speech', voice:{speaker:'zh_female_vv_uranus_bigtts',speechRate:0},tasks:[],operations:[],audio:[]};
state.status.modification = ['codex','user'].includes(lock) ? {owner:lock} : null;
await action(()=>[...timers.values()].forEach(cb=>cb()));
check(document.querySelector('[data-delete-confirm]').disabled, '弹窗期间共享锁阻止确认：'+lock);
await input({click:'dialog [data-delete-confirm]'}); check(state.batchRequests.length === 1, '锁定不提交');
}
await input({key:'Escape'}); check(!dialog(), '锁定仍可取消');
state.status.modification=null; state.speech.locked=false;
await action(()=>[...timers.values()].forEach(cb=>cb()));
await right('a'); await input({key:'Enter'});
// 未轮询到的占用也必须重新申请修改权；服务拒绝显示反馈。
state.current = {};
await input({click:'dialog [data-delete-confirm]'});
check(state.batchRequests.length === 1 && document.querySelector('footer').textContent.includes('用户正在编辑'), '确认时重新申请修改权');
document.getElementById('result').dataset.state='passed';
} catch(e) { document.getElementById('result').dataset.state='failed'; document.getElementById('result').textContent=e.stack; }})();
`;
const raceFixture = fixture.replace(
  "if (change.kind === 'delete') state.status.snapshot.segments = state.status.snapshot.segments.filter(item => item.id !== change.expected.id);",
  "if (change.kind === 'delete') { const current = state.status.snapshot.segments.find(item => item.id === change.expected.id); if (JSON.stringify(current) === JSON.stringify(change.expected)) state.status.snapshot.segments = state.status.snapshot.segments.filter(item => item.id !== change.expected.id); }",
).replace("results: [] };", "results: batch.changes.map((change,index) => ({ index, outcome: index ? 'deleted' : 'changed', message: index ? '口播片段已删除，已跳过' : '口播片段内容已变化，已跳过' })) };");
test('确认删除保持旧快照并反馈过时目标，动态任务锁及修改权阻止提交', {skip:chrome ? false:'需要 Chrome',timeout:40000}, t=>checkInteractiveBrowser(t,raceScript,raceFixture));
