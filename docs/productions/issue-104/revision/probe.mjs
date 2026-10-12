import {bundle} from '@remotion/bundler';
import {selectComposition,renderStill} from '@remotion/renderer';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(process.argv[2]??path.join(root,'revision/frames'));fs.mkdirSync(out,{recursive:true});
const cards=JSON.parse(fs.readFileSync(path.join(root,'revision/cards.json')));
const browserExecutable='/usr/bin/google-chrome';
const serveUrl=await bundle({entryPoint:path.join(root,'revision/entry.tsx'),publicDir:path.join(root,'public'),outDir:path.join(root,'revision/bundle'),ignoreRegisterRootWarning:true});
const records=[];
for(const card of cards){
 const inputProps={card,preview:false,playAudio:false};
 const composition=await selectComposition({serveUrl,id:'RevisionAsset',inputProps,browserExecutable});
 for(const portion of [.35,.72]){
  const frame=Math.floor((card.durationInFrames-1)*portion);const output=path.join(out,`${card.id}-${Math.round(portion*100)}.png`);
  await renderStill({serveUrl,composition,inputProps,browserExecutable,frame,output});records.push({id:card.id,frame,portion,output});
 }
 console.log(card.id+' 两个实际无损帧完成');
}
fs.writeFileSync(path.join(out,'samples.json'),JSON.stringify({role:'有限无损帧可视与动作检查，非逐帧/终审',records},null,2)+'\n');
