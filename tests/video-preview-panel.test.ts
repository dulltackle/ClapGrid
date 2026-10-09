import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from './helpers/editing-fixture.js';
import { checkInteractiveBrowser } from './helpers/interactive-browser.js';

const script = String.raw`
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './src/panel/app.tsx';
import { state } from 'editing-fixture';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const check=(v,m)=>{if(!v)throw Error(m);};
const settle=()=>new Promise(r=>setTimeout(r,100));
const action=async fn=>{await act(async()=>{await fn();await settle();});await settle();};
(async()=>{try{
 state.status.snapshot.assets=[{id:'asset',name:'实际测试视频.mp4',duration:8}];
 state.status.snapshot.segments[0].video={assetId:'asset',start:1};
 await action(()=>createRoot(document.getElementById('root')).render(<App/>));
 document.querySelector('.ag-body-horizontal-scroll-viewport').scrollLeft=600;await settle();
 const trigger=()=>document.querySelector('[aria-label="播放 实际测试视频.mp4"]');
 check(!document.querySelector('[row-id="segment"]').textContent.includes('实际测试视频.mp4'),'素材列不常驻文件名');
 await action(()=>window.browserInput({click:'[aria-label="播放 实际测试视频.mp4"]'}));
 check(!document.querySelector('aside'),'预览不打开详情');
 const player=document.querySelector('video');
 for(let i=0;i<30 && (player.readyState<2 || player.paused || player.currentTime<1);i++)await settle();
 check(player.controls && !player.paused && player.duration===8 && player.currentTime>=1,'实际视频从关联起点播放：'+JSON.stringify({ready:player.readyState,paused:player.paused,time:player.currentTime,duration:player.duration,error:player.error?.message,url:player.currentSrc}));
 await action(()=>player.pause());check(player.paused,'可以暂停');
 await action(()=>{player.currentTime=4;});check(Math.abs(player.currentTime-4)<0.3,'可以定位进度');
 await action(()=>player.play());check(!player.paused,'可以恢复播放');
 await action(()=>window.browserInput({key:'Tab'}));check(document.activeElement.closest('[role="dialog"]'),'视频弹窗键盘焦点约束');
 await action(()=>window.browserInput({key:'Escape'}));
 check(!document.querySelector('video') && document.activeElement.closest('[row-id="segment"]'),'Escape 停止预览并返回原片段');
 await action(()=>window.browserInput({click:'[aria-label="查看片段 1 的详情"]'}));
 await new Promise(r=>setTimeout(r,350));
 const drawer=document.querySelector('aside'), bounds=drawer.getBoundingClientRect();
 check(bounds.left>=0 && bounds.right<=innerWidth && bounds.bottom<=innerHeight,'宽窄视口侧栏始终可达');
 if(matchMedia('(prefers-reduced-motion: reduce)').matches)check(getComputedStyle(drawer).transitionDuration==='0s','减少动态效果禁用侧栏动画');
 await window.browserInput({screenshot:'wide-preview-drawer-'+innerHeight});
 document.getElementById('result').dataset.state='passed';
}catch(e){document.getElementById('result').dataset.state='failed';document.getElementById('result').textContent=e.stack;}})();
`;
for (const [width, height] of [[1200, 800], [780, 579], [420, 800], [420, 360]]) {
  test(`缩略图实际播放与侧栏可达性（${width}×${height}）`, { timeout: 40000 }, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'clapgrid-video-94-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10', '-t', '8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(directory, 'clip.mp4')]);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-i', join(directory, 'clip.mp4'), '-frames:v', '1', join(directory, 'thumb.png')]);
    await checkInteractiveBrowser(t, script, fixture, width, height, { reducedMotion: width === 420, resources: {
      '/api/media/asset/thumbnail': { body: readFileSync(join(directory, 'thumb.png')), type: 'image/png' },
      '/api/media/asset/preview': { body: readFileSync(join(directory, 'clip.mp4')), type: 'video/mp4' },
    } });
  });
}
