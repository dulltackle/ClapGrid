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
const intervals = new Map(); let timer = 0;
window.setInterval = callback => { intervals.set(++timer, callback); return timer; };
window.clearInterval = id => intervals.delete(id);
const check = (ok, message) => { if (!ok) throw Error(message); };
const action = async fn => { await act(async () => { await fn(); await new Promise(r => setTimeout(r, 100)); }); await new Promise(r => setTimeout(r, 180)); };
const input = options => action(() => window.browserInput(options));
const pointer = (id, type, fraction = 0.5) => input({ pointer: { selector: '[row-id="' + id + '"] [col-id="order"]', type, fraction } });
const refresh = () => action(() => [...intervals.values()].forEach(fn => fn()));
const order = ids => check(state.status.snapshot.segments.map(s => s.id).join() === ids, '项目顺序应为 ' + ids);
(async () => { try {
state.status.snapshot.segments=Array.from({length:100},(_,i)=>({id:String(i+1),order:i+1,text:'片段 '+(i+1),video:null}));
await action(() => createRoot(document.getElementById('root')).render(<App />));
await input({pointer:{selector:'[row-id="1"] [aria-label^="拖动片段 "]',type:'mousePressed'}});
await pointer('5','mouseMoved',0.8);
const r=document.querySelector('[row-id="5"] [col-id="order"]').getBoundingClientRect();
const x=r.x+r.width/2,y=r.y+r.height*.8;
await input({pointer:{x,y,type:'mouseWheel',buttons:1,deltaY:4000}});
await action(()=>new Promise(r=>setTimeout(r,400)));
const target=document.elementFromPoint(x,y).closest('[row-id]').getAttribute('row-id');
check(Number(target)>30,'滚轮后新目标存在');
check(document.querySelector('[aria-label="口播片段插入位置"]')?.dataset.targetId===target,'滚轮后静止指针的插入线更新到当前目标');
await input({pointer:{x,y,type:'mouseReleased'}});
const ids=state.status.snapshot.segments.map(s=>s.id);
check(ids.indexOf('1')===ids.indexOf(target)+1,'静止指针应采用滚轮后的目标 '+target+'，实际片段 1 位置 '+ids.indexOf('1'));
  document.getElementById('result').dataset.state='passed';
} catch(error) { document.getElementById('result').dataset.state='failed'; document.getElementById('result').textContent=error.stack; } })();
`;
for (const width of [1600,420]) test('拖拽滚轮后静止指针采用当前目标 '+width, {skip: chrome ? false : '未执行：需要 Chrome/Chromium', timeout:40000}, t=>checkInteractiveBrowser(t,script,fixture,width));
