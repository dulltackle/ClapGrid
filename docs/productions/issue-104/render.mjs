import {bundle} from '@remotion/bundler';
import {selectComposition,renderMedia,renderStill} from '@remotion/renderer';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const root=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1]};
const cardPath=path.resolve(root,option('--card','cards/FH10.json'));
const card=JSON.parse(fs.readFileSync(cardPath,'utf8'));
const audio=path.resolve(root,card.audio);
const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',audio]));
if(!probe.streams.some(s=>s.codec_type==='audio'))throw new Error('输入缺少音轨');
card.audioDuration=Number(probe.format.duration);
card.durationInFrames=Math.ceil(card.audioDuration*30);
if(!Number.isFinite(card.audioDuration)||card.audioDuration<=0)throw new Error('无效音频时长');
const out=path.resolve(root,option('--out','outputs'));
fs.mkdirSync(out,{recursive:true});
const entry=path.resolve(root,option('--entry','index.tsx'));
const browserExecutable=option('--browser',process.env.CHROME_PATH||'/usr/bin/google-chrome');
// 各组入口通过共享 registerProduction 调用 registerRoot。
const serveUrl=await bundle({entryPoint:entry,publicDir:path.join(root,'public'),outDir:path.join(root,'bundle'),ignoreRegisterRootWarning:true});
for(const preview of [false,true]){
 const inputProps={card,preview};
 const composition=await selectComposition({serveUrl,id:'Production',inputProps,browserExecutable});
 const name=`${card.id}-${preview?'review-picture':'assembly'}.mp4`;
 await renderMedia({serveUrl,composition,inputProps,browserExecutable,muted:true,codec:'h264',outputLocation:path.join(out,name),concurrency:2});
 await renderStill({serveUrl,composition,inputProps,browserExecutable,frame:Math.max(0,card.durationInFrames-11),output:path.join(out,`${card.id}-${preview?'review':'assembly'}.png`)});
}
// 原速完整音频；画面最多补足一帧，不使用 shortest、裁剪或变速。
execFileSync('ffmpeg',['-y','-v','error','-i',path.join(out,`${card.id}-review-picture.mp4`),'-i',audio,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','128k','-af','apad','-t',String(card.durationInFrames/30),'-movflags','+faststart',path.join(out,`${card.id}-review.mp4`)]);
// 浏览器审阅副本；尺寸减半，不替代正式 MP4 媒体规格核对。
execFileSync('ffmpeg',['-y','-v','error','-i',path.join(out,`${card.id}-review.mp4`),'-vf','scale=960:540','-c:v','libvpx','-b:v','1200k','-c:a','libvorbis',path.join(out,`${card.id}-review.webm`)]);
fs.unlinkSync(path.join(out,`${card.id}-review-picture.mp4`));
fs.writeFileSync(path.join(out,`${card.id}-render.json`),JSON.stringify({card,entry:path.relative(root,entry),browserExecutable,audioProbe:probe,outputs:[`${card.id}-assembly.mp4`,`${card.id}-review.mp4`,`${card.id}-review.webm`]},null,2)+'\n');
console.log(`${card.id} 原音频 ${card.audioDuration} 秒，画面 ${card.durationInFrames}/30 秒；装配与审阅分开输出`);
