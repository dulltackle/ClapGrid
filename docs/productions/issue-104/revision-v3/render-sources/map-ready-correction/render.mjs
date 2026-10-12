import {bundle} from '@remotion/bundler';
import {selectComposition,renderMedia,renderStill} from '@remotion/renderer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.dirname(fileURLToPath(import.meta.url));
const out=path.join(directory,'outputs');fs.mkdirSync(out,{recursive:true});
const cards=JSON.parse(fs.readFileSync(path.join(directory,'cards.json')));
const filter=process.argv.includes('--ids')?process.argv[process.argv.indexOf('--ids')+1].split(','):null;
const selected=filter?cards.filter(c=>filter.includes(c.id)):cards;
if(filter&&selected.length!==filter.length)throw new Error('选择包含未知或重复片段');
const recordName=process.argv.includes('--record')?process.argv[process.argv.indexOf('--record')+1]:(filter?'render-note-clarification.json':'render-complete.json');
if(!/^render-[a-z-]+\.json$/.test(recordName))throw new Error('渲染记录名无效');
const boundary=process.argv.includes('--boundary');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const sourceFiles=['art.tsx','intro.tsx','mechanism.tsx','outro.tsx','scene.tsx','entry.tsx','cards.json','render.mjs'];
const resources=['public/artwork-v3/full-femur-v03.png','public/artwork-v3/proximal-v01.png','public/artwork-v3/section-v01.png','public/artwork-v3/tissue-v01.png','public/artwork-v3/tissue-repair-v01.png','public/fonts/noto-cjk-sc.otf','src/shared.tsx','src/anatomy.tsx','package.json','package-lock.json'];
const sourcePaths=Object.fromEntries([...sourceFiles.map(p=>[p,path.join(directory,p)]),...resources.map(p=>[p,path.join(root,p)])]);
const fingerprint=()=>Object.fromEntries(Object.entries(sourcePaths).map(([name,p])=>[name,sha(p)]));
const sourceBefore=fingerprint();
const snapshot=path.join(directory,'render-sources',recordName.replace(/^render-|\.json$/g,''));
if(fs.existsSync(snapshot))throw new Error('不得覆盖已留存的实际渲染源批次');
for(const [name,p] of Object.entries(sourcePaths)){const target=path.join(snapshot,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(p,target);}

const browserExecutable='/usr/bin/google-chrome';
const serveUrl=await bundle({entryPoint:path.join(directory,'entry.tsx'),publicDir:path.join(root,'public'),outDir:path.join(directory,'bundle-render'),ignoreRegisterRootWarning:true});
const records=[];
for(const card of selected){
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
 const boundaryFrames=[];
 if(boundary)for(const frame of [0,7,13,14]){const output=path.join(out,`${card.id}-boundary-${frame}.png`);await renderStill({serveUrl,composition,inputProps,browserExecutable,frame,output});boundaryFrames.push({frame,path:output,sha256:sha(output)});}
 records.push({boundaryFrames,id:card.id,segmentId:card.segmentId,taskId:card.taskId,originalAudioSha256:card.audioSha256,outputLocation,sha256:sha(outputLocation),durationInFrames:composition.durationInFrames,frames});
 fs.writeFileSync(path.join(out,filter?'note-progress.json':'progress.json'),JSON.stringify({role:'实际纯素材，无旁白/字幕；仅已完成记录',sourceBefore,records},null,2)+'\n');
 console.log(`${card.id} 完成 ${composition.durationInFrames} 帧与3个无损采样`,{flush:true});
}
const sourceAfter=fingerprint();
if(JSON.stringify(sourceBefore)!==JSON.stringify(sourceAfter))throw new Error('渲染期间源文件变化，结果不能标通过');
fs.writeFileSync(path.join(out,recordName),JSON.stringify({status:'complete',version:'full-rough-v3',selectedIds:selected.map(c=>c.id),scopeNote:filter?`所选片段 ${selected.map(c=>c.id).join(',')} 的实际重渲；其他产物是否保留见汇合记录`:'首次15段重制',sourceBefore,sourceAfter,records,browserExecutable,parameters:{width:1920,height:1080,fps:30,codec:'h264',crf:18,muted:true,assemblyNarrationSubtitle:false},scope:'15实际纯素材和每段3无损帧，实际ClapGrid全片导出和人审另做'},null,2)+'\n');
