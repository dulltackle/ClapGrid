"""实际正式媒体探测/全长解码、48k单声道PCM及原始PNG区域抽样。"""
import pathlib,json,subprocess,hashlib,datetime,argparse
parser=argparse.ArgumentParser();parser.add_argument('root');args=parser.parse_args();root=pathlib.Path(args.root)
probe=lambda p:json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(p)]))
roi=[752,55,890,166];frames=[0,71,84,94,104,115]
media=[];pcm={};durations={}
for name in ['before','slow']:
 c=json.loads((root/f'cards/FH10-{name}.json').read_text());raw=root/c['audio'];duration=float(probe(raw)['format']['duration']);durations[name]=duration;count=__import__('math').ceil(duration*30)
 for kind,sound in [('assembly.mp4',False),('review.mp4',True),('review.webm',True)]:
  p=root/f'outputs/FH10-{name}-{kind}';meta=probe(p);v=next(s for s in meta['streams'] if s['codec_type']=='video');assert bool([s for s in meta['streams'] if s['codec_type']=='audio'])==sound
  if kind.endswith('mp4'):assert(v['width'],v['height'],v['r_frame_rate'])==(1920,1080,'30/1');assert duration<=float(meta['format']['duration'])<=duration+1/30+.002
  dec=subprocess.run(['ffmpeg','-v','error','-i',str(p),'-f','null','-'],capture_output=True,check=True);assert not dec.stderr,dec.stderr.decode();media.append({'path':str(p.relative_to(root)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'probe':meta,'decode':{'exitCode':0,'stderr':''}})
 audio=subprocess.run(['ffmpeg','-v','error','-i',str(root/f'outputs/FH10-{name}-review.mp4'),'-map','0:a:0','-ar','48000','-ac','1','-f','s16le','-'],check=True,capture_output=True);assert not audio.stderr;pcm[name]={'sha256':hashlib.sha256(audio.stdout).hexdigest(),'bytes':len(audio.stdout),'sampleRate':48000,'channels':1,'sampleFormat':'s16le'}
assert pcm['before']==pcm['slow'],'解码音轨不一致'
assert durations['before']==durations['slow']
frames+=[count-1];samples=[]
for frame in frames:
 images=[]
 for name in ['before','slow']:
  p=root/f'outputs/FH10-{name}-frame-{frame}.png';raw=subprocess.run(['ffmpeg','-v','error','-i',str(p),'-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True,check=True);assert not raw.stderr;assert len(raw.stdout)==1920*1080*3;images.append(raw.stdout)
 a,b=images;box=None
 if a!=b:
  coords=[]
  for y in range(1080):
   start=y*1920*3;rowA=a[start:start+1920*3];rowB=b[start:start+1920*3]
   if rowA==rowB:continue
   assert roi[1]<=y<roi[3],f'帧{frame}的差异超出ROI纵向'
   assert rowA[:roi[0]*3]==rowB[:roi[0]*3] and rowA[roi[2]*3:]==rowB[roi[2]*3:],f'帧{frame}的差异超出ROI横向'
   coords.extend((x,y) for x in range(roi[0],roi[2]) if rowA[x*3:x*3+3]!=rowB[x*3:x*3+3])
  box=[min(x for x,y in coords),min(y for x,y in coords),max(x for x,y in coords)+1,max(y for x,y in coords)+1]
 samples.append({'frame':frame,'differenceBounds':box,'outsideROIIdentical':True,'beforeRGBSha256':hashlib.sha256(a).hexdigest(),'slowRGBSha256':hashlib.sha256(b).hexdigest()})
assert any(s['differenceBounds'] for s in samples),'没有实际动作差异'
for s in samples:
 if s['frame'] in [0,71,115,count-1]:assert s['differenceBounds'] is None,'非移动时点出现意外差异'
cards=[json.loads((root/f'cards/FH10-{n}.json').read_text()) for n in ['before','slow']]
for key in ['segmentId','text','voice','taskId','audio','audioSha256','audioDuration','durationInFrames']:assert cards[0][key]==cards[1][key],key
report={'status':'passed','observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceDirectory':str(root.resolve()),'roiPredetermined':roi,'sampleScope':'仅列出的原始无损Remotion PNG时点，不声称每帧','sampleFrames':samples,'decodedPCM':pcm,'media':media,'currentAudioDuration':duration,'durationInFrames':count,'unchangedInputs':['稳定身份','确认旁白','原音频','声音输入','任务身份','完整字幕','总帧长','无关骨结构与放大图时序'],'motionChange':'仅motion.slow令箭头移动更慢；版本id不渲染'}
(root/'evidence/110-compare.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print('两版媒体通过，解码PCM一致，关键无损PNG差异仅在预定箭头ROI；仅采样结论。')
