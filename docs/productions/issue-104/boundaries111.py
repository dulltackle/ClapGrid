"""保存真实输出在段边界前后及首末帧的技术采样；不声明人工画面终审。"""
from pathlib import Path
import subprocess,json,hashlib,math
root=Path(__file__).resolve().parent
plan=json.loads((root/'full-inputs/current111.json').read_text());out=root/'evidence/111-boundaries';out.mkdir(exist_ok=True)
report=json.loads((root/'evidence/111-verification.json').read_text());last=int(next(x for x in report['outputs'][0]['probe']['streams'] if x['codec_type']=='video')['nb_read_frames'])-1
samples=[('first',0),('last',last)]
for s in plan['segments'][1:]:
 boundary=math.ceil(s['start']*30-1e-9);samples.extend([(s['logicalCard'].replace('–','-')+'-before',boundary-1),(s['logicalCard'].replace('–','-')+'-after',boundary)])
frames=[]
for label,n in samples:
 dest=out/(label+'.png');cmd=['ffmpeg','-y','-v','error','-i',str(root/'outputs/full-rough-v1.mp4'),'-vf',f'select=eq(n\\,{n})','-frames:v','1','-fps_mode','vfr',str(dest)];p=subprocess.run(cmd,capture_output=True);assert p.returncode==0 and p.stderr==b'' and dest.is_file()
 frames.append({'label':label,'frame':n,'timeSeconds':n/30,'path':str(dest.relative_to(root)),'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'command':cmd,'stderr':'','scope':'真实MP4边界邻帧采样，交独立检查；不自动证明机制或字幕连续性终审'})
(root/'evidence/111-boundaries.json').write_text(json.dumps({'scope':'14处累计原声边界两侧+首末帧，共30帧；解码产物、未执行人工终审','segments':[{'card':s['logicalCard'],'start':s['start'],'end':s['end']} for s in plan['segments']],'samples':frames},ensure_ascii=False,indent=2)+'\n')
print('已提取30个真实首末/边界帧')
