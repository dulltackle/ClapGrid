import json,pathlib,subprocess,hashlib,sys,math
root=pathlib.Path(sys.argv[1]); manifest=json.loads((root/'manifest.json').read_text())
for f in manifest['files']:
 p=root/f['path']; assert p.is_file(),str(p); assert hashlib.sha256(p.read_bytes()).hexdigest()==f['sha256'],str(p)
card=json.loads((root/'cards/FH10.json').read_text()); assert card['text']=='如果局部结构继续受损，承重时就可能出现细小骨折。'
probe=lambda p:json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(p)]))
audio=probe(root/card['audio']); duration=float(audio['format']['duration'])
decoded=subprocess.run(['ffmpeg','-v','error','-i',str(root/card['audio']),'-f','null','-'],check=True,capture_output=True)
assert not decoded.stderr,decoded.stderr.decode()
for name,sound in [('assembly',False),('review',True)]:
 p=root/'outputs'/f'FH10-{name}.mp4'; meta=probe(p); video=next(s for s in meta['streams'] if s['codec_type']=='video'); assert (video['width'],video['height'],video['r_frame_rate'])==(1920,1080,'30/1'); assert bool([s for s in meta['streams'] if s['codec_type']=='audio'])==sound
 assert duration<=float(meta['format']['duration'])<=duration+1/30+.002
 decoded=subprocess.run(['ffmpeg','-v','error','-i',str(p),'-f','null','-'],check=True,capture_output=True)
 assert not decoded.stderr,decoded.stderr.decode()
webm=root/'outputs/FH10-review.webm'
decoded=subprocess.run(['ffmpeg','-v','error','-i',str(webm),'-f','null','-'],check=True,capture_output=True)
assert not decoded.stderr,decoded.stderr.decode()
print(json.dumps({'status':'passed','scope':'FH10档案文件校验、真实媒体全长解码、1920×1080/30fps、完整音频覆盖、装配无音轨及预览有音轨','audioDuration':duration},ensure_ascii=False))
