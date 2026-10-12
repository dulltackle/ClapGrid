"""核对第三版实际制作输出的媒体/原声边界；不以像素差异代签动画美感。"""
import json,hashlib,subprocess,pathlib,sys,math
root=pathlib.Path(sys.argv[1]);out=root/'revision-v3/outputs';cards=json.loads((root/'revision-v3/cards.json').read_text());baseline=json.loads((root/'full-inputs/current111.json').read_text())['segments'];assert len(cards)==len(baseline)==15
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();results=[]
for card,original in zip(cards,baseline):
 assert card['segmentId']==original['segmentId'] and card['text']==original['text'] and card['taskId']==original['taskId'] and card['voice']=={'speaker':'zh_female_vv_uranus_bigtts','speechRate':0}
 assert sha(root/card['audio'])==card['audioSha256']==original['audioSha256']
 media=out/(card['id']+'-assembly.mp4');assert media.exists(),'待制作本轮纯画面，旧版不能充当新版本: '+str(media)
 p=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_streams','-show_format','-of','json',str(media)]));assert len(p['streams'])==1 and p['streams'][0]['codec_type']=='video';v=p['streams'][0];assert (v['width'],v['height'],v['r_frame_rate'])==(1920,1080,'30/1');assert int(v['nb_read_frames'])==math.ceil(card['audioDuration']*30);assert card['audioDuration']<=float(p['format']['duration'])<=card['audioDuration']+1/30+.002
 d=subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(media),'-f','null','-'],capture_output=True);assert d.returncode==0 and not d.stderr,d.stderr.decode();results.append({'card':card['id'],'path':str(media),'sha256':sha(media),'probe':p,'decodeExitCode':0,'decodeStderr':''})
print(json.dumps({'status':'passed','scope':'15实际纯素材、稳定身份和确认原文/声音/原MP3 SHA保持、1920×1080/30fps/完整帧长与无音轨、全部完整解码；转场/明显机制动作与风格另做实际视觉及用户判断','media':results},ensure_ascii=False))
