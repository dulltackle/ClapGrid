"""在公开媒体与独立档案边界核对本组成果，不锁定SVG内部实现。"""
import hashlib,json,math,pathlib,subprocess,sys
root=pathlib.Path(sys.argv[1])
manifest=json.loads((root/'manifest.json').read_text())
for f in manifest['files']:
    p=root/f['path']
    assert p.is_file(),str(p)
    assert hashlib.sha256(p.read_bytes()).hexdigest()==f['sha256'],str(p)
expected={
'FH13':'不过，并不是每个坏死的股骨头都会塌陷。',
'FH14':'受损范围、位置等因素，都会影响进展。',
'FH15':'所以，坏死说的是骨组织死亡。',
'FH16':'塌陷说的是支撑结构失效后，外形发生了改变。'}
mapping=json.loads((root/'segment-mapping.json').read_text())['segments']
speech=json.loads((root/'evidence/109-actual-speech.json').read_text())
provenance=json.loads((root/'references/109-source.json').read_text())
assert (root/provenance['generationRecord']).is_file()
prompts=json.loads((root/provenance['generationPrompts']).read_text())
assert prompts['提示词']
report=[]
for name,text in expected.items():
    card=json.loads((root/'cards'/f'{name}.json').read_text())
    assert card['text']==text and card['voice']=={'speaker':'zh_female_vv_uranus_bigtts','speechRate':0}
    stable=next(x for x in mapping if x['card']==name)
    assert card['segmentId']==stable['segmentId'] and card['order']==stable['order'] and card['text']==stable['text']
    task=next(x for x in speech['tasks'] if x['id']==card['taskId'])
    actual=next(x for x in speech['audio'] if x['taskId']==card['taskId'])
    assert task['state']=='succeeded' and actual['valid'] and actual['segmentId']==card['segmentId']
    assert actual['input']==task['input']=={'text':card['text'],'voice':card['voice']}
    assert hashlib.sha256((root/card['audio']).read_bytes()).hexdigest()==card['audioSha256']
    audio=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-of','json',str(root/card['audio'])]))
    duration=float(audio['format']['duration'])
    for mode,sound in [('assembly',False),('review',True)]:
        media=root/'outputs'/f'{name}-{mode}.mp4'
        meta=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_streams','-show_format','-of','json',str(media)]))
        v=next(x for x in meta['streams'] if x['codec_type']=='video')
        assert (v['width'],v['height'],v['r_frame_rate'])==(1920,1080,'30/1')
        assert any(x['codec_type']=='audio' for x in meta['streams'])==sound
        assert int(v['nb_read_frames'])==card['durationInFrames']==math.ceil(duration*30)
        assert duration<=float(meta['format']['duration'])<=duration+1/30+.002
    for media in [root/'outputs'/f'{name}-assembly.mp4',root/'outputs'/f'{name}-review.mp4',root/'outputs'/f'{name}-review.webm']:
        decoded=subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(media),'-f','null','-'],capture_output=True)
        assert decoded.returncode==0 and not decoded.stderr,decoded.stderr.decode()
    report.append({'card':name,'segmentId':card['segmentId'],'audioSeconds':duration,'frames':math.ceil(duration*30)})
continuous=json.loads((root/'evidence/109-continuous-media.json').read_text())
assert abs(continuous['originalAudioTotal']-sum(x['audioSeconds'] for x in report))<.000001
for name,size in [('group109-review.mp4',(1920,1080)),('group109-review.webm',(960,540))]:
    p=root/'outputs'/name
    meta=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_streams','-show_format','-of','json',str(p)]))
    v=next(x for x in meta['streams'] if x['codec_type']=='video')
    assert (v['width'],v['height'])==size and v['r_frame_rate']=='30/1' and int(v['nb_read_frames'])==continuous['frames']
    assert any(x['codec_type']=='audio' for x in meta['streams']) and float(meta['format']['duration'])>=continuous['originalAudioTotal']
    decoded=subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(p),'-f','null','-'],capture_output=True)
    assert decoded.returncode==0 and not decoded.stderr,decoded.stderr.decode()
for name,sound in [('FH16-assembly.mp4',False),('FH16-review.mp4',True),('FH16-review.webm',True)]:
    p=root/'outputs/group109-reproduced'/name
    meta=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_streams','-show_format','-of','json',str(p)]))
    v=next(x for x in meta['streams'] if x['codec_type']=='video')
    assert v['r_frame_rate']=='30/1' and int(v['nb_read_frames'])==141
    assert (v['width'],v['height'])==((960,540) if p.suffix=='.webm' else (1920,1080))
    assert any(x['codec_type']=='audio' for x in meta['streams'])==sound
    decoded=subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(p),'-f','null','-'],capture_output=True)
    assert decoded.returncode==0 and not decoded.stderr,decoded.stderr.decode()
changedRestore=root/'outputs/group109-reproduced-FH15'
assert manifest['version']!='group109-v2' or changedRestore.exists()
if changedRestore.exists():
    for name,sound in [('FH15-assembly.mp4',False),('FH15-review.mp4',True),('FH15-review.webm',True)]:
        p=changedRestore/name
        meta=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_streams','-show_format','-of','json',str(p)]))
        v=next(x for x in meta['streams'] if x['codec_type']=='video')
        assert v['r_frame_rate']=='30/1' and int(v['nb_read_frames'])==109
        assert (v['width'],v['height'])==((960,540) if p.suffix=='.webm' else (1920,1080))
        assert any(x['codec_type']=='audio' for x in meta['streams'])==sound
        decoded=subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(p),'-f','null','-'],capture_output=True)
        assert decoded.returncode==0 and not decoded.stderr,decoded.stderr.decode()
print(json.dumps({'status':'passed','scope':'本组四段精确旁白/独立档案哈希/媒体参数/原声完整覆盖/全长解码无错误','segments':report},ensure_ascii=False))
