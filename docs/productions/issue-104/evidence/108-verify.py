import json,pathlib,subprocess,sys,hashlib
root=pathlib.Path(sys.argv[1]); out=root/(sys.argv[2] if len(sys.argv)>2 else 'outputs'); card=json.loads((root/'cards/FH11-FH12.json').read_text())
assert card['segmentId']=='e509e18d-edab-4700-8695-3df351c66a4e'
assert card['text']=='损伤进一步发展，关节面下方的骨组织可能失去支撑，表面发生局部下陷。'
if (root/'manifest.json').exists():
 for item in json.loads((root/'manifest.json').read_text())['files']:
  assert hashlib.sha256((root/item['path']).read_bytes()).hexdigest()==item['sha256'],item['path']
probe=lambda p:json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(p)]))
audio=probe(root/card['audio']); duration=float(audio['format']['duration']); report={}
for name,sound in [('assembly.mp4',False),('review.mp4',True),('review.webm',True)]:
 p=out/('FH11-FH12-'+name); meta=probe(p); video=next(s for s in meta['streams'] if s['codec_type']=='video')
 assert (video['width'],video['height'])==((960,540) if name.endswith('webm') else (1920,1080)); assert video['r_frame_rate']=='30/1'
 assert bool([s for s in meta['streams'] if s['codec_type']=='audio'])==sound
 assert duration<=float(meta['format']['duration'])<=duration+1/30+.05
 if sound: assert next(s for s in meta['streams'] if s['codec_type']=='audio').get('duration',meta['format']['duration']) and float(next(s for s in meta['streams'] if s['codec_type']=='audio').get('duration',meta['format']['duration']))>=duration-.08
 result=subprocess.run(['ffmpeg','-v','error','-i',str(p),'-f','null','-'],check=True,capture_output=True); assert not result.stderr,result.stderr
 report[name]={'probe':meta,'fullDecodeStderr':'','status':'passed'}
result=subprocess.run(['ffmpeg','-v','error','-i',str(root/card['audio']),'-f','null','-'],check=True,capture_output=True); assert not result.stderr
print(json.dumps({'status':'passed','audioDuration':duration,'scope':'稳定身份、完整原文、1920×1080/30fps正式媒体、原声覆盖、装配无音轨、MP4/WebM与原声完整解码','media':report},ensure_ascii=False,indent=2))
