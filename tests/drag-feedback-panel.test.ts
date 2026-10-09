import { test } from 'node:test';
import { chrome } from './helpers/browser.js';
import { fixture } from './helpers/editing-fixture.js';
import { checkInteractiveBrowser } from './helpers/interactive-browser.js';

// 将实际宿主中数百毫秒的取得编辑权/保存等待固定为闸门，避免依赖机器速度。
const script = String.raw`
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './src/panel/app.tsx';
import { state, deferred } from 'editing-fixture';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const intervals = new Map(); let timer = 0;
window.setInterval = fn => { intervals.set(++timer, fn); return timer; }; window.clearInterval = id => intervals.delete(id);
const check = (ok, message) => { if (!ok) throw Error(message); };
const action = async fn => { await act(async () => { await fn(); await new Promise(r=>setTimeout(r,80)); }); };
const input = options => action(()=>window.browserInput(options));
const position = id => document.querySelector('[row-id="'+id+'"]').getAttribute('row-index');
(async()=>{try {
  state.status.snapshot.segments = Array.from({length: SEGMENT_COUNT}, (_,index)=>({id:String(index+1),order:index+1,text: index > 2 ? '用于复核拖拽反馈的长口播。'.repeat(150) : '片段 '+(index+1),video:null}));
  await action(()=>createRoot(document.getElementById('root')).render(<App/>));
  state.acquireGate = deferred();
  await input({pointer:{selector:'[row-id="1"] [aria-label^="拖动片段 "]',type:'mousePressed'}});
  await input({pointer:{selector:'[row-id="2"] [col-id="order"]',type:'mouseMoved',fraction:0.8}});
  await input({pointer:{selector:'[row-id="2"] [col-id="order"]',type:'mouseReleased',fraction:0.8}});
  check(position('1')==='1', '松手后仍停留在原位置，视觉反馈被取得编辑权阻塞');
  check(document.querySelector('footer').textContent.includes('保存中'), '取得编辑权期间须显示保存中');
  check(state.saves===0, '视觉预览不能提前写入项目');
  await action(()=>[...intervals.values()].forEach(fn=>fn()));
  check(position('1')==='1', '保存期间轮询不能覆盖预览');
  state.saveGate = deferred();
  await action(()=>state.acquireGate.resolve());
  check(position('1')==='1', '等待提交结果期间保持预览顺序');
  await action(()=>state.saveGate.resolve());
  check(position('1')==='1' && state.status.snapshot.segments[1].id==='1', '成功后采用已保存顺序');
  state.acquireGate=null; state.saveGate=null; state.batchFailure=true;
  await action(()=>[...intervals.values()].forEach(fn=>fn()));
  await action(()=>new Promise(r=>setTimeout(r,350)));
  await input({pointer:{selector:'[row-id="1"] [aria-label^="拖动片段 "]',type:'mousePressed'}});
  await input({pointer:{selector:'[row-id="2"] [col-id="order"]',type:'mouseMoved',fraction:0.2}});
  await input({pointer:{selector:'[row-id="2"] [col-id="order"]',type:'mouseReleased',fraction:0.2}});
  check(position('1')==='1', '失败后恢复已确认的项目顺序');
  check(document.querySelector('footer').textContent.includes('保存失败'), '失败必须明确展示');
  document.getElementById('result').dataset.state='passed';
}catch(error){document.getElementById('result').dataset.state='failed';document.getElementById('result').textContent=error.stack;}})();
`;
for (const count of [2, 8]) test('拖拽松手后立即预览顺序，异步保存失败恢复 '+count, {skip:chrome?false:'未执行：需要 Chrome/Chromium',timeout:15000}, t=>checkInteractiveBrowser(t,script.replace('SEGMENT_COUNT', String(count)),fixture));
