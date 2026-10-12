import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {bundle} from '@remotion/bundler';
import {selectComposition,renderStill} from '@remotion/renderer';
const root=path.dirname(fileURLToPath(import.meta.url));
if(process.argv.includes('--before-only')&&process.argv.includes('--slow-only'))throw new Error('只能选择一版');
const names=process.argv.includes('--before-only')?['before']:process.argv.includes('--slow-only')?['slow']:['before','slow'];
// ROI在渲染前由原型箭头几何+边缘余量确定，单位为正式1920×1080输出像素。
const roi=[752,55,890,166];
const sampleFrames=[0,71,84,94,104,115];
for(const name of names){
 execFileSync(process.execPath,[path.join(root,'render.mjs'),'--entry','entry110.tsx','--card',`cards/FH10-${name}.json`,'--out','outputs'],{cwd:root,stdio:'inherit'});
 const card=JSON.parse(fs.readFileSync(path.join(root,`cards/FH10-${name}.json`),'utf8'));
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-of','json',path.join(root,card.audio)]));
 card.audioDuration=Number(probe.format.duration);card.durationInFrames=Math.ceil(card.audioDuration*30);
 const inputProps={card,preview:true};
 const serveUrl=await bundle({entryPoint:path.join(root,'entry110.tsx'),publicDir:path.join(root,'public'),outDir:path.join(root,'bundle'),ignoreRegisterRootWarning:true});
 const composition=await selectComposition({serveUrl,id:'Production',inputProps,browserExecutable:'/usr/bin/google-chrome'});
 const frames=[...sampleFrames,card.durationInFrames-1];
 for(const frame of frames)await renderStill({serveUrl,composition,inputProps,browserExecutable:'/usr/bin/google-chrome',frame,output:path.join(root,'outputs',`FH10-${name}-frame-${frame}.png`)});
 fs.writeFileSync(path.join(root,'outputs',`110-${name}-sample-scope.json`),JSON.stringify({frames,roi,width:1920,height:1080,scope:'原始Remotion无损PNG关键时点采样，不声称穷举逐帧',durationInFrames:card.durationInFrames,audioDuration:card.audioDuration},null,2)+'\n');
}
