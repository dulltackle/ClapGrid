"""从已完成的一次真实宿主导出采样制作可移交输入，不调用生成或导出。"""
from pathlib import Path
import json,hashlib,shutil,subprocess,array,datetime
ROOT=Path(__file__).resolve().parent
RUN=Path('/home/forclaw/tmp/implement-spec-104')
MEDIA=Path('/home/forclaw/code/ClapGrid/clapgrid/media')
TASK='2846fb35-8435-4043-b0d7-e7aa9f5a2b75'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def unwrap(x):
 if isinstance(x,dict):
  for k in ['response','result','structuredContent']:
   if k in x:return unwrap(x[k])
  if 'content' in x:return unwrap(json.loads(next(t['text'] for t in x['content'] if t['type']=='text')))
 return x
def clean(x):
 if isinstance(x,dict):return {k:clean(v) for k,v in x.items() if k.lower() not in ['url','previewurl','token','signature','binding']}
 if isinstance(x,list):return [clean(v) for v in x]
 if isinstance(x,str) and '/binding/' in x:return '[能力地址已移除]'
 return x
def read(f):return json.loads((RUN/f).read_text())
def write(f,x):
 p=ROOT/f;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(clean(x),ensure_ascii=False,indent=2)+'\n')
def copy(a,b):
 p=ROOT/b;p.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(a,p);return sha(p)
def snapshot(f):
 raw=read(f);u=unwrap(raw);s=u['snapshot'];ids={x['segmentId'] for x in mapping};segs=[x for x in s['segments'] if x['id'] in ids];assets={x['video']['assetId'] for x in segs}
 return {'observedAt':raw['observedAt'],'buildIdentity':u['buildIdentity'],'instanceId':u['instanceId'],'taskLocked':u['taskLocked'],'project':s['project'],'segments':segs,'assets':[a for a in s['assets'] if a['id'] in assets],'exportSettings':s['exportSettings']}
def speech(f):
 raw=read(f);u=unwrap(raw);ids={x['segmentId'] for x in mapping};audio=[a for a in u['audio'] if a['segmentId'] in ids];tids={a['taskId'] for a in audio}
 return {'observedAt':raw['observedAt'],'voice':u['voice'],'locked':u['locked'],'tasks':[t for t in u['tasks'] if t['id'] in tids],'audio':audio}
mapping=json.loads((ROOT/'segment-mapping.json').read_text())['segments'];host=snapshot('111-host-before.json');sp=speech('111-speech-before.json')
write('evidence/111-host-before.json',host);write('evidence/111-speech-before.json',sp)
write('evidence/111-host-after.json',snapshot('111-host-after.json'));write('evidence/111-speech-after.json',speech('111-speech-after.json'))
write('evidence/111-after-state-correspondence.json',read('111-after-state-correspondence.json'))
settings=unwrap(read('111-settings-before.json'));settings['selectedFontAvailable']='Noto Sans CJK SC' in str(settings['fonts']);settings.pop('fonts');settings['observedAt']=read('111-settings-before.json')['observedAt'];write('evidence/111-settings-before.json',settings)
status=read('111-export-status-01.json');selected=next(t for t in unwrap(status)['tasks'] if t['id']==TASK)
write('evidence/111-export-succeeded.json',{'observedAt':status.get('observedAt'), 'task':selected,'output':{'mp4Sha256':sha(ROOT/'outputs/full-rough-v1.mp4'),'webmSha256':sha(ROOT/'outputs/full-rough-v1.webm'),'mp4OriginalPath':selected['output']['path'],'webmOriginalPath':str(MEDIA/(TASK+'.export.webm'))}})
write('evidence/111-submit-export.json',{'observedAt':read('111-submit-export.json').get('observedAt'),'task':unwrap(read('111-submit-export.json'))})
write('evidence/111-browser-full-playback.json',read('111-browser-full-playback.json'))
frames=read('111-frame-samples.json')
for s in frames['samples']:
 old=s['file'];dst='evidence/111-frames/'+Path(old).name;assert copy(Path(old),dst)==s['sha256'];s['originalFile']=old;s['file']=dst
write('evidence/111-frame-samples.json',frames)
plan={'version':'full-rough-v1','previousVersion':None,'exportTaskId':TASK,'sourceBaseline':'c117e34bc1723d00bf553c7d752fa5b6eb171b5b','segments':[]};n=0
for m in mapping:
 name='FH10-slow' if m['card']=='FH10' else ('FH11-FH12' if m['card']=='FH11–FH12' else m['card']);cp='cards/'+name+'.json';c=json.loads((ROOT/cp).read_text());seg=next(s for s in host['segments'] if s['id']==m['segmentId']);a=next(a for a in sp['audio'] if a['segmentId']==m['segmentId']);aid=seg['video']['assetId'];tid=a['taskId']
 ap='full-inputs/audio/'+name+'.mp3';vp='full-inputs/assets/'+name+'.source.mp4';ah=copy(MEDIA/(tid+'.mp3'),ap);vh=copy(MEDIA/(aid+'.source'),vp)
 assert ah==sha(ROOT/c['audio']);assert vh==sha(ROOT/(c.get('关联素材') or c['素材'])['assembly'])
 pcm=subprocess.check_output(['ffmpeg','-v','error','-i',str(ROOT/ap),'-ac','1','-ar','48000','-f','f32le','-']);samples=len(pcm)//4
 plan['segments'].append({'logicalCard':m['card'],'cardPath':cp,'reviewVersion':c.get('reviewVersion',c.get('version')),'segmentId':m['segmentId'],'order':m['order'],'text':m['text'],'taskId':tid,'assetId':aid,'assetStart':seg['video']['start'],'audioPath':ap,'audioSha256':ah,'originalAudioPath':str(MEDIA/(tid+'.mp3')),'assemblyPath':vp,'assemblySha256':vh,'originalAssemblyPath':str(MEDIA/(aid+'.source')),'decodedAudioSamples48k':samples,'start':n/48000,'end':(n+samples)/48000});n+=samples
plan['originalAudioTotal']=n/48000;write('full-inputs/current111.json',plan)
files=[p for p in (ROOT/'src').rglob('*') if p.is_file()]+list(ROOT.glob('entry*.tsx'))
write('evidence/111-source-contract.json',{'scope':'纯画面装配的已审源与真实关联字节；源码结构标注不包含旁白烧录字幕，独立阅读核对；无字幕流不足以证明无烧录字幕','files':[{'path':str(p.relative_to(ROOT)),'sha256':sha(p)} for p in sorted(files)]})
font=Path('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc');license=Path('/usr/share/doc/fonts-noto-cjk/copyright');dep=RUN/'archives/fh10-v1/dependency-resources-linux-x64.tgz'
resources=[]
for a,b,role in [(font,'full-inputs/resources/fonts/NotoSansCJK-Regular.ttc','实际ClapGrid ASS 字体'),(license,'full-inputs/resources/fonts/noto-cjk-copyright','系统字体授权'),(dep,'full-inputs/resources/dependency-resources-linux-x64.tgz','锁定动画依赖包')]:
 resources.append({'path':b,'source':str(a),'role':role,'sha256':copy(a,b)})
write('full-inputs/resources/resources111.json',{'resources':resources,'fcMatchCommand':"fc-match 'Noto Sans CJK SC' -f '%{file}|%{family}|%{style}\\n'",'fcMatchActualOutput':subprocess.check_output(['fc-match','Noto Sans CJK SC','-f','%{file}|%{family}|%{style}\n']).decode(),'animationFont':{'path':'public/fonts/noto-cjk-sc.otf','sha256':sha(ROOT/'public/fonts/noto-cjk-sc.otf'),'role':'Remotion FontFace，区别于真实全片ASS的TTC'}})
print('已生成15个真实输入与过滤证据；原声总长',n/48000)
