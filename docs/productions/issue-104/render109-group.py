"""用单段审阅画面与原始配音独立装配本组连续预览，避免累计AAC容器尾部。"""
from pathlib import Path
import subprocess,json,math,hashlib
root=Path(__file__).resolve().parent
cards=[json.loads((root/'cards'/f'FH{i}.json').read_text()) for i in range(13,17)]
outputs=root/'outputs';outputs.mkdir(exist_ok=True)
time=0.;segments=[];lines=[]
for card in cards:
 audio=root/card['audio'];probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-of','json',str(audio)]));duration=float(probe['format']['duration']);assert duration==card['audioDuration']
 picture=root/'outputs'/f"{card['id']}-review.mp4"
 assert "'" not in str(picture)
 lines += [f"file '{picture}'",f'duration {duration:.9f}']
 segments.append({'id':card['id'],'segmentId':card['segmentId'],'start':round(time,9),'end':round(time+duration,9),'originalAudioSeconds':duration,'audioSha256':hashlib.sha256(audio.read_bytes()).hexdigest(),'pictureSha256':hashlib.sha256(picture.read_bytes()).hexdigest()});time+=duration
listing=outputs/'group109-picture-concat.txt';listing.write_text('\n'.join(lines)+'\n')
cmd=['ffmpeg','-y','-v','error','-f','concat','-safe','0','-i',str(listing)]
for card in cards:cmd+=['-i',str(root/card['audio'])]
# 音频保留全部解码样本并原速连接；只补足原MP3实测容器时长的静音尾部。
filters=[f'[{i+1}:a:0]aresample=24000,apad=whole_dur={c["audioDuration"]}[a{i}]' for i,c in enumerate(cards)]
filters+=[''.join(f'[a{i}]' for i in range(4))+'concat=n=4:v=0:a=1[a]']
cmd+=['-filter_complex',';'.join(filters),'-map','0:v:0','-map','[a]','-c:v','libx264','-preset','fast','-crf','20','-r','30','-frames:v',str(math.ceil(time*30)),'-c:a','aac','-b:a','128k','-movflags','+faststart',str(outputs/'group109-review.mp4')]
subprocess.run(cmd,check=True)
subprocess.run(['ffmpeg','-y','-v','error','-i',str(outputs/'group109-review.mp4'),'-vf','scale=960:540','-c:v','libvpx','-b:v','1200k','-c:a','libvorbis',str(outputs/'group109-review.webm')],check=True)
records=[]
for p in [outputs/'group109-review.mp4',outputs/'group109-review.webm']:
 probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_streams','-show_format','-of','json',str(p)]));v=next(s for s in probe['streams'] if s['codec_type']=='video');assert v['r_frame_rate']=='30/1';assert int(v['nb_read_frames'])==math.ceil(time*30);assert (v['width'],v['height'])==((1920,1080) if p.suffix=='.mp4' else (960,540));assert float(probe['format']['duration'])>=time
 decode=subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(p),'-f','null','-'],capture_output=True);assert decode.returncode==0 and decode.stderr==b'';records.append({'file':str(p.relative_to(root)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'probe':probe,'decodeReturncode':decode.returncode,'decodeStderr':decode.stderr.decode()})
(root/'evidence/109-continuous-media.json').write_text(json.dumps({'segments':segments,'originalAudioTotal':round(time,9),'frames':math.ceil(time*30),'frameTimelineSeconds':math.ceil(time*30)/30,'timingBasis':'各段原始MP3实际探测时长，独立定位画面与完整原速原声；不读取单段AAC预览容器时长作累加','command':cmd,'records':records},ensure_ascii=False,indent=2)+'\n')
