import { test } from './helpers/playwright-browser.js';
import { fixture } from './helpers/editing-fixture.js';


const script = String.raw`
import { createRoot } from 'react-dom/client';
import { App } from './src/panel/app.tsx';
import { state } from 'editing-fixture';
window.setInterval = () => 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (ok, message) => { if (!ok) throw Error(message); };
(async () => { try {
  state.status.snapshot.segments = Array.from({length: ROW_COUNT}, (_, i) => i + 1).map(i => ({id:String(i), order:i, text:'口播片段 '+i, video:null}));
  createRoot(document.getElementById('root')).render(<App/>);
  while (!document.querySelector('[row-id="2"]')) await delay(20);
  const row = id => document.querySelector('[row-id="'+id+'"]');
  const overlay = id => getComputedStyle(row(id).querySelector('.ag-grid-scrolling-cells'), '::before');
  const highlighted = id => { const s=overlay(id); return s.content !== 'none' && s.backgroundColor === 'rgb(240, 241, 243)'; };
  for (const pointerType of ['pen','mouse']) {
    for (const id of [1,2,1]) {
      await window.browserInput({pointer:{type:'mouseMoved',pointerType,selector:'[row-id="'+id+'"] [col-id="text"]',buttons:0}});
      await new Promise(requestAnimationFrame);
      check(highlighted(id), pointerType+' 悬浮到片段 '+id+' 后下一帧必须高亮');
      check(!highlighted(id===1?2:1), '离开的片段不能保留高亮');
      check(getComputedStyle(row(id).querySelector('[aria-label="拖动片段 '+id+'"]')).opacity === '1', '拖动手柄及时显示');
    }
  }
  await window.browserInput({click:'[row-id="1"] input[type="checkbox"]'});
  await delay(30);
  check(row(1).classList.contains('ag-row-selected'), '勾选状态保持');
  check(highlighted(1) && overlay(1).backgroundImage !== 'none', '悬浮与勾选背景叠加');
  await window.browserInput({pointer:{type:'mouseMoved',pointerType:'pen',selector:'[row-id="2"] [col-id="text"]',buttons:0}});
  await new Promise(requestAnimationFrame);
  check(!highlighted(1) && overlay(1).backgroundColor !== 'rgba(0, 0, 0, 0)', '离开后保留勾选背景');
  check(getComputedStyle(row(1).querySelector('[aria-label="拖动片段 1"]')).opacity === '0', '离开后隐藏拖动手柄');
  document.getElementById('result').dataset.state='passed';
} catch(error) {document.getElementById('result').dataset.state='failed';document.getElementById('result').textContent=error.stack;} })();
`;
for (const count of [2, 7]) {
  test(`笔与鼠标悬浮时口播片段高亮及时跟随（${count} 行）`, async ({ panel }) => { test.setTimeout(30000); await (panel.check(script.replace('ROW_COUNT', String(count)), fixture, 1200, 800)); });
}
