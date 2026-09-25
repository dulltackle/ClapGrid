"""一次性试听原型：三种音色，失败不自动重试，不保存密钥。"""
import base64,json,os,urllib.request,urllib.error
from pathlib import Path
out=Path(__file__).parent
key=None
for line in Path('.env').read_text().splitlines():
 s=line.strip().removeprefix('export ')
 if s.startswith('TOKENDANCE_KEY='):
  key=s.split('=',1)[1].strip().strip('\"\'')
if not key: raise SystemExit('未找到 TOKENDANCE_KEY')
text='做口播视频，最费时间的往往不是录制，而是反复修改。把文案分成20个片段，配上视频，再用AI生成配音。预算是19.9元，目标输出1080P。改好一句后，只更新对应配音。先听一遍：语气是否自然，停顿是否合适？'
voices=[('A-vivi','vivi 2.0','zh_female_vv_uranus_bigtts'),('B-fluent','流畅女声','zh_female_santongyongns_saturn_bigtts'),('C-yichen','儒雅逸辰','zh_male_ruyayichen_saturn_bigtts')]
results=[]
for slug,name,speaker in voices:
 payload={'req_params':{'text':text,'speaker':speaker,'audio_params':{'format':'mp3','sample_rate':24000,'speech_rate':0,'loudness_rate':0}}}
 req=urllib.request.Request('https://tokendance.space/gateway/ark/v3/tts/unidirectional',data=json.dumps(payload).encode(),headers={'Authorization':'Bearer '+key,'X-Api-Resource-Id':'seed-tts-2.0','Content-Type':'application/json'})
 record={'name':name,'speaker':speaker,'request':payload,'status':'failed'}
 audio=bytearray(); done=False
 try:
  with urllib.request.urlopen(req,timeout=60) as response:
   for line in response:
    if not line.startswith(b'data:'): continue
    frame=json.loads(line[5:].strip())
    code=frame.get('code')
    if code not in (0,20000000):
     record['error_code']=code
     break
    if frame.get('data'): audio.extend(base64.b64decode(frame['data']))
    if code==20000000:
     done=True
     record['usage']=frame.get('usage')
     break
  if done and audio:
   path=out/(slug+'.mp3');path.write_bytes(audio)
   record.update(status='complete',file=path.name,bytes=len(audio))
 except urllib.error.HTTPError as e:
  record['http_status']=e.code
 except Exception as e:
  record['error_type']=type(e).__name__
 results.append(record)
 print(json.dumps({k:v for k,v in record.items() if k!='request'},ensure_ascii=False),flush=True)
 (out/'manifest.json').write_text(json.dumps({'model':'seed-tts-2.0','text':text,'samples':results},ensure_ascii=False,indent=2))
 if record.get('http_status') in (401,402,403,429): break
