"""从归档的原音频和制作卡重新渲染本组，不请求配音服务。"""
import pathlib,subprocess,argparse,json,hashlib,datetime

parser=argparse.ArgumentParser();parser.add_argument('--root',default=str(pathlib.Path(__file__).resolve().parent.parent));parser.add_argument('--log-dir',required=True);mode=parser.add_mutually_exclusive_group();mode.add_argument('--representative-only',action='store_true');mode.add_argument('--continuous-only',action='store_true');args=parser.parse_args()
root=pathlib.Path(args.root).resolve();logs=pathlib.Path(args.log_dir).resolve();logs.mkdir(parents=True,exist_ok=True)
ids=['FH03'] if args.representative_only else ['FH01','FH02','FH03','FH04']
render_out='outputs/group106-reproduced' if args.representative_only else 'outputs'
for id in ([] if args.continuous_only else ids):
 command=['node','render.mjs','--entry','entry106.tsx','--card',f'cards/{id}.json','--out',render_out]
 with (logs/f'{id}-render.log').open('wb') as log:subprocess.run(command,cwd=root,stdout=log,stderr=subprocess.STDOUT,check=True)
if not args.representative_only:
 # 显式解码重编码，避免AAC分段编码补齐导致拼接包/时间戳异常。
 command=['ffmpeg','-y','-v','error']
 for id in ids:command+=['-i',str(root/'outputs'/f'{id}-review.mp4')]
 filters=[]
 for i,id in enumerate(ids):
  metadata=json.loads((root/'outputs'/f'{id}-render.json').read_text());seconds=metadata['card']['durationInFrames']/30
  # 仅去除AAC容器额外补齐：这个边界晚于完整原音频结束，不裁切旁白。
  assert seconds>=metadata['card']['audioDuration']
  filters+=[f'[{i}:v:0]setpts=PTS-STARTPTS[v{i}]',f'[{i}:a:0]atrim=duration={seconds},asetpts=PTS-STARTPTS[a{i}]']
 filters+=[''.join(f'[v{i}][a{i}]' for i in range(4))+'concat=n=4:v=1:a=1[v][a]']
 command+=['-filter_complex',';'.join(filters),'-map','[v]','-map','[a]','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','128k','-movflags','+faststart',str(root/'outputs/group106-review.mp4')]
 with (logs/'continuous-render.log').open('wb') as log:subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,check=True)
 subprocess.run(['ffmpeg','-y','-v','error','-i',str(root/'outputs/group106-review.mp4'),'-vf','scale=960:540','-c:v','libvpx','-b:v','1200k','-c:a','libvorbis',str(root/'outputs/group106-review.webm')],check=True)
 print('FH01–FH04各段装配与配音字幕预览、连续审阅预览已输出')
else:print('独立档案代表段FH03已实际重新渲染')
