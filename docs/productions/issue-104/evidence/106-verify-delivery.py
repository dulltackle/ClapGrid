import json,pathlib,hashlib,subprocess,sys
root=pathlib.Path(sys.argv[1]);m=json.loads((root/'manifest.json').read_text())
for f in m['files']:
 p=root/f['path'];assert p.is_file(),str(p);assert hashlib.sha256(p.read_bytes()).hexdigest()==f['sha256'],str(p)
probe=lambda p:json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(p)]))
expected=['股骨头坏死，为什么可能让原本圆滑的关节面塌陷？','先看这里：大腿骨顶端的球形部分，就是股骨头。','它表面覆盖软骨，下面是支撑关节面的骨组织。','骨组织也是活的，需要血液不断送来氧气和营养。']
total_audio=0
for n,text in enumerate(expected,1):
 card=json.loads((root/f'cards/FH{n:02}.json').read_text());assert card['text']==text
 raw=probe(root/card['audio']);duration=float(raw['format']['duration'])
 total_audio+=duration
 for kind,sound in [('assembly',False),('review',True)]:
  path=root/'outputs'/f'FH{n:02}-{kind}.mp4';p=probe(path);v=next(s for s in p['streams'] if s['codec_type']=='video');assert(v['width'],v['height'],v['r_frame_rate'])==(1920,1080,'30/1');assert bool([s for s in p['streams'] if s['codec_type']=='audio'])==sound;assert duration<=float(p['format']['duration'])<=duration+1/30+.002
 for file in [root/card['audio'],root/'outputs'/f'FH{n:02}-assembly.mp4',root/'outputs'/f'FH{n:02}-review.mp4',root/'outputs'/f'FH{n:02}-review.webm']:
  d=subprocess.run(['ffmpeg','-v','error','-i',str(file),'-f','null','-'],capture_output=True,check=True);assert not d.stderr,d.stderr.decode()
for file in [root/'outputs/group106-review.mp4',root/'outputs/group106-review.webm']:
 d=subprocess.run(['ffmpeg','-v','error','-i',str(file),'-f','null','-'],capture_output=True,check=True);assert not d.stderr,d.stderr.decode()
group=probe(root/'outputs/group106-review.mp4');v=next(s for s in group['streams'] if s['codec_type']=='video');assert(v['width'],v['height'],v['r_frame_rate'])==(1920,1080,'30/1');assert total_audio<=float(group['format']['duration'])<=total_audio+4/30+.03
for kind,sound in [('assembly.mp4',False),('review.mp4',True),('review.webm',True)]:
 file=root/'outputs/group106-reproduced'/f'FH03-{kind}';p=probe(file);assert bool([s for s in p['streams'] if s['codec_type']=='audio'])==sound;d=subprocess.run(['ffmpeg','-v','error','-i',str(file),'-f','null','-'],capture_output=True,check=True);assert not d.stderr,d.stderr.decode()
print(json.dumps({'status':'passed','scope':'FH01–FH04确认旁白、独立档案全文件SHA、实测音频完整覆盖、1920×1080/30fps、装配无音轨、预览有音轨、原音频/单段/连续预览全长无错误解码'},ensure_ascii=False))
