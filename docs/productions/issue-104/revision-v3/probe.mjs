import {bundle} from '@remotion/bundler';
import {selectComposition,renderStill} from '@remotion/renderer';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(process.argv[2]??path.join(root,'revision-v3/frames'));fs.mkdirSync(out,{recursive:true});
const cards=JSON.parse(fs.readFileSync(path.join(root,'revision-v3/cards.json')));
const browserExecutable='/usr/bin/google-chrome';
const serveUrl=await bundle({entryPoint:path.join(root,'revision-v3/entry.tsx'),publicDir:path.join(root,'public'),outDir:path.join(root,'revision-v3/bundle'),ignoreRegisterRootWarning:true});
const records=[];
for(const card of cards.filter(c=>process.argv.includes('--all')||['FH01','FH02','FH06','FH08','FH11-FH12','FH15'].includes(c.id))){
 const inputProps={card,preview:false,playAudio:false};
 const composition=await selectComposition({serveUrl,id:'RevisionAsset',inputProps,browserExecutable});
 for(const portion of [.35,.72,.93]){
  const frame=Math.floor((card.durationInFrames-1)*portion);const output=path.join(out,`${card.id}-${Math.round(portion*100)}.png`);
  await renderStill({serveUrl,composition,inputProps,browserExecutable,frame,output});records.push({id:card.id,frame,portion,output});
 }
 console.log(card.id+' 三个实际无损帧完成');
}
fs.writeFileSync(path.join(out,'samples.json'),JSON.stringify({role:'有限无损帧可视与动作检查，非逐帧/终审',records},null,2)+'\n');
