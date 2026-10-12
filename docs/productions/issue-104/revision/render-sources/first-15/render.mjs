import {bundle} from '@remotion/bundler';
import {selectComposition,renderMedia,renderStill} from '@remotion/renderer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'revision');
const out=path.join(directory,'outputs');fs.mkdirSync(out,{recursive:true});
const cards=JSON.parse(fs.readFileSync(path.join(directory,'cards.json')));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const sourceFiles=['art.tsx','intro.tsx','mechanism.tsx','outro.tsx','scene.tsx','entry.tsx','cards.json','render.mjs'];
const sourceBefore=Object.fromEntries(sourceFiles.map(p=>[p,sha(path.join(directory,p))]));
const browserExecutable='/usr/bin/google-chrome';
const serveUrl=await bundle({entryPoint:path.join(directory,'entry.tsx'),publicDir:path.join(root,'public'),outDir:path.join(directory,'bundle-render'),ignoreRegisterRootWarning:true});
const records=[];
for(const card of cards){
 const inputProps={card,preview:false,playAudio:false};
 const composition=await selectComposition({serveUrl,id:'RevisionAsset',inputProps,browserExecutable});
 if(composition.durationInFrames!==Math.ceil(card.audioDuration*30))throw new Error('实测配音与素材帧长不对应');
 const outputLocation=path.join(out,`${card.id}-assembly.mp4`);
 await renderMedia({serveUrl,composition,inputProps,browserExecutable,muted:true,codec:'h264',crf:18,outputLocation,concurrency:2});
 const frames=[];
 for(const portion of [.35,.72,.93]){
  const frame=Math.floor((card.durationInFrames-1)*portion);const output=path.join(out,`${card.id}-${Math.round(portion*100)}.png`);
  await renderStill({serveUrl,composition,inputProps,browserExecutable,frame,output});frames.push({frame,portion,path:output,sha256:sha(output)});
 }
 records.push({id:card.id,segmentId:card.segmentId,taskId:card.taskId,originalAudioSha256:card.audioSha256,outputLocation,sha256:sha(outputLocation),durationInFrames:composition.durationInFrames,frames});
 fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({role:'实际纯素材，无旁白/字幕；仅已完成记录',sourceBefore,records},null,2)+'\n');
 console.log(`${card.id} 完成 ${composition.durationInFrames} 帧与3个无损采样`,{flush:true});
}
const sourceAfter=Object.fromEntries(sourceFiles.map(p=>[p,sha(path.join(directory,p))]));
if(JSON.stringify(sourceBefore)!==JSON.stringify(sourceAfter))throw new Error('渲染期间源文件变化，结果不能标通过');
fs.writeFileSync(path.join(out,'render-complete.json'),JSON.stringify({status:'complete',version:'full-rough-v2',sourceBefore,sourceAfter,records,browserExecutable,parameters:{width:1920,height:1080,fps:30,codec:'h264',crf:18,muted:true,assemblyNarrationSubtitle:false},scope:'15实际纯素材和每段3无损帧，实际ClapGrid全片导出和人审另做'},null,2)+'\n');
