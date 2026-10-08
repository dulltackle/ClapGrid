import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chrome, checkBrowser } from './helpers/browser.js';
import { checkInteractiveBrowser } from './helpers/interactive-browser.js';
import { fixture } from './helpers/editing-fixture.js';

const setup = String.raw`
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './src/panel/app.tsx';
import { state, deferred } from 'editing-fixture';
import { assertTheme, assertKeyboardFocus } from './tests/helpers/theme-contract.ts';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const timers = new Map(); let timer = 0;
window.setInterval = cb => { timers.set(++timer, cb); return timer; }; window.clearInterval = id => timers.delete(id);
const action = async cb => act(async () => { await cb(); await new Promise(r => setTimeout(r, 50)); });
const check = (v, m) => { if (!v) throw Error(m); };
const field = label => document.querySelector('[aria-label="'+label+'"]');
const button = text => [...document.querySelectorAll('button')].find(n => n.textContent === text);
const click = text => action(() => { const node = button(text); check(node && !node.disabled, '按钮可用：'+text); node.click(); });
const poll = () => action(() => [...timers.values()].forEach(cb => cb()));
const change = (label, value) => action(() => { const n = field(label); n.value = value; n.dispatchEvent(new Event('change', {bubbles:true})); });
const size = value => action(() => { const n = field('字幕字号（px）'); n.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(n,value); n.dispatchEvent(new Event('input',{bubbles:true})); });
const commitSize = () => action(() => field('字幕字号（px）').blur());
const root = createRoot(document.getElementById('root'));
const pass = () => document.getElementById('result').dataset.state='passed';
const fail = e => { document.getElementById('result').dataset.state='failed'; document.getElementById('result').textContent=e.stack; };
`;

test('导出表单保留修改权、加载反馈、自动保存和字号提交规则', {timeout:30000}, async t => {
  assert.ok(chrome, '导出表单验收必须实际运行浏览器');
  await checkBrowser(t, setup + String.raw`
(async () => { try {
await action(() => root.render(<App/>));
state.settingsGate = deferred();
await click('更多'); await click('导出设置');
check(state.leases.length === 0, '查看不申请修改权');
check(document.body.textContent.includes('正在检查媒体组件与字体'), '媒体和字体加载反馈');
check(document.body.textContent.includes('适用于全片') && document.body.textContent.includes('不会生成配音或更改已有成片'), '保留全片影响说明');
state.status.taskLocked=true; await poll(); check(button('编辑设置').disabled,'任务锁禁止编辑');
state.status.taskLocked=false; state.status.modification={owner:'agent'}; await poll(); check(button('编辑设置').disabled,'已有修改占用禁止编辑');
state.status.modification=null; await poll();
state.status.snapshot.exportSettings.fps=25;
await click('编辑设置'); check(field('导出帧率').value==='25','编辑重新读取可靠设置');
check(field('字幕字体').disabled,'字体未加载时保持禁用');
state.fonts=['New Font']; state.settingsIssues=['请确认媒体组件'];
await action(() => { state.settingsGate.resolve(); state.settingsGate=null; });
check(field('字幕字体').selectedOptions[0].textContent.includes('当前不可用'),'已选不可用字体仍可见');
check(field('导出编码') instanceof HTMLSelectElement && field('导出帧率') instanceof HTMLSelectElement && field('字幕字体') instanceof HTMLSelectElement,'三个选择器保留原生语义');
check([...field('导出帧率').options].map(o=>o.value).join()==='24,25,30,50,60','帧率选项保持');
check([...field('导出编码').options].map(o=>o.value).join()==='libx264,mpeg4','编码选项保持');
check(document.body.textContent.includes('请确认媒体组件'),'待解决项可见');
const lease=state.current;
await change('字幕字体','New Font'); await change('导出编码','mpeg4'); await change('导出帧率','60');
check(state.settingsRequests.length===3 && state.current===lease && lease.closes===0,'选择自动保存并保留修改权');
check(state.settingsRequests[0].expected.fontFamily==='Test' && state.settingsRequests.every(r=>r.token===lease.token),'保存保留旧快照及修改权协议');
check(document.body.textContent.includes('已保存'),'已保存反馈');
await size('48'); check(state.settingsRequests.length===3,'输入不提前保存');
await action(() => field('字幕字号（px）').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
check(field('字幕字号（px）') && document.body.textContent.includes('字号尚未保存'),'未提交字号 Escape 保留弹窗并提示');
await commitSize(); check(state.status.snapshot.exportSettings.fontSize===48,'失焦提交字号');
await size('1080'); await action(() => field('字幕字号（px）').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
check(state.status.snapshot.exportSettings.fontSize===1080,'Enter 提交上界');
await size('1'); await commitSize(); check(state.status.snapshot.exportSettings.fontSize===1,'下界可以提交');
await size(''); await commitSize(); check(state.status.snapshot.exportSettings.fontSize===null,'未设置提交 null');
for (const value of ['0','1081','1.5']) { await size(value); await commitSize(); check(document.body.textContent.includes('保存失败') && state.status.snapshot.exportSettings.fontSize===null,'无效字号保留已保存值并反馈：'+value); }
state.saveFailure=true; await change('导出帧率','24');
check(field('导出帧率').value==='60' && document.body.textContent.includes('保存失败'),'保存失败保留已保存设置');
state.saveFailure=false; state.saveGate=deferred(); await change('导出帧率','24');
check(button('关闭设置').disabled && field('导出编码').disabled && document.body.textContent.includes('保存中'),'保存中禁止操作及关闭');
await action(() => field('字幕字号（px）').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
check(field('导出帧率'),'保存中 Escape 不关闭');
await action(() => { state.saveGate.resolve(); state.saveGate=null; });
await size('77'); await action(() => lease.disconnect());
check(field('字幕字号（px）').value==='' && field('字幕字号（px）').disabled && document.body.textContent.includes('编辑连接已断开，未提交输入已取消'),'断开取消字号草稿并提示');
await click('关闭设置'); await poll();
state.settingsFailure=true; await click('更多'); await click('导出设置');
check(document.body.textContent.includes('媒体组件与字体读取失败'),'字体读取失败明确反馈');
await click('编辑设置'); check(field('字幕字体').disabled,'读取失败仍禁用字体');
const lastLease=state.current; await click('关闭设置'); check(lastLease.closes===1,'关闭释放修改权一次');
pass();
} catch(e) { fail(e); } })();`, fixture);
});

for (const [width,height] of [[1600,1000],[420,800],[420,360]]) test(`导出表单生产主题与控件可达性 ${width}×${height}`, {timeout:40000}, async t => {
  assert.ok(chrome, '主题矩阵必须实际运行 Chrome');
  await checkInteractiveBrowser(t, setup + String.raw`
const input = async request => { await action(() => window.browserInput(request)); await new Promise(r => setTimeout(r, 200)); };
const bounds = node => { const r=node.getBoundingClientRect(); check(r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight,'控件在视口内可达'); };
(async () => { try {
await action(() => root.render(<App/>)); await click('更多'); await click('导出设置');
for (const label of ['导出编码','导出帧率','字幕字体','字幕字号（px）']) { assertTheme('form',field(label)); assertTheme('disabled',field(label)); }
await click('编辑设置');
for (const label of ['导出编码','导出帧率','字幕字体','字幕字号（px）']) assertTheme('form',field(label));
await input({key:'Tab'});
for (const label of ['导出编码','导出帧率','字幕字体','字幕字号（px）']) {
 const n=field(label); await action(() => { n.scrollIntoView({block:'center'}); n.focus(); });
 bounds(n); assertKeyboardFocus(n); check(n.getBoundingClientRect().height>=32,'控件高度至少 32px');
}
const close=button('关闭设置'); await action(() => close.scrollIntoView({block:'center'})); bounds(close); assertTheme('cancel',close);
await input({key:'Tab'}); assertKeyboardFocus(close);
check(getComputedStyle(document.querySelector('.grid')).display==='block','真实表格仍使用原布局');
check(getComputedStyle(button('更多')).borderTopWidth==='1px','未迁移按钮保留边框');
await input({key:'Enter'}); check(!field('导出编码'),'关闭操作可达');
pass();
} catch(e) { fail(e); } })();`, fixture,width,height);
});
