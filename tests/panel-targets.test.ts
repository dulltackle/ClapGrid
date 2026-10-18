import { test } from './helpers/playwright-browser.js';
import assert from 'node:assert/strict';



test('定位助手适应行高变化和覆盖区，实际就绪晚于固定延时仍可等待', async ({ panel }) => { test.setTimeout(30000);
  
  return panel.check(String.raw`
import { waitForPanel, visiblePanelPoint, rowScrollDistance } from './tests/helpers/panel-targets.ts';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
(async()=>{try {
const root=document.getElementById('root');
root.innerHTML='<div id="row" style="position:fixed;left:20px;top:20px;width:300px;height:80px">目标</div><div style="position:fixed;left:100px;top:20px;width:220px;height:80px;background:white">覆盖</div>';
const row=document.getElementById('row');
for(const height of [80,102,140]) {row.style.height=height+'px';if(rowScrollDistance(row,40)!==height*40)throw Error('不能依赖旧行高');}
const point=visiblePanelPoint(row);if(point.x>=100 || document.elementFromPoint(point.x,point.y)!==row)throw Error('应该命中仍可见的左侧');
setTimeout(()=>{const editor=document.createElement('textarea');editor.id='editor';root.append(editor);},400);
const editor=await waitForPanel(()=>document.getElementById('editor'),'迟到的编辑器');if(!editor)throw Error('必须等待实际就绪');
let timedOut=false;try{await waitForPanel(()=>false,'永远不会就绪的组件',80);}catch{timedOut=true;}if(!timedOut)throw Error('等待必须有界');
document.getElementById('result').dataset.state='passed';
}catch(error){document.getElementById('result').dataset.state='failed';document.getElementById('result').textContent=error.stack;}})();`, 'export {};');
});
