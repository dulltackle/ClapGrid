"""汇合首次十五段、三段提示语及后继转场修订的真实输出；保留各批次实际源码身份。"""
from pathlib import Path
import json,hashlib,subprocess,array,sys
root=Path(sys.argv[1]);run=Path('/home/forclaw/tmp/implement-spec-104');out=root/'revision/outputs';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
first=json.loads((run/'revision-v2-note-before/render-complete.json').read_text());second=json.loads((out/'render-note-clarification.json').read_text());assert first['status']==second['status']=='complete';assert second['selectedIds']==['FH08','FH09','FH10'];records={r['id']:dict(r,renderSourceIdentity=first['sourceBefore'],renderBatch='first-15') for r in first['records']}
for r in second['records']:records[r['id']]=dict(r,renderSourceIdentity=second['sourceBefore'],renderBatch='note-clarification-only-3')
third=json.loads((out/'render-transition-correction.json').read_text());assert third['status']=='complete' and third['selectedIds']==['FH11-FH12']
for r in third['records']:records[r['id']]=dict(r,renderSourceIdentity=third['sourceBefore'],renderBatch='transition-correction')
roi=[0,760,1920,880];diffs=[]
for id in ['FH08','FH09','FH10']:
 for n in [35,72,93]:
  paths=[run/'revision-v2-note-before/outputs'/f'{id}-{n}.png',out/f'{id}-{n}.png'];rgb=[]
  for p in paths:
   d=subprocess.run(['ffmpeg','-v','error','-i',str(p),'-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True);assert d.returncode==0 and not d.stderr;assert len(d.stdout)==1920*1080*3;rgb.append(d.stdout)
  a,b=rgb;assert a[:760*1920*3]==b[:760*1920*3] and a[880*1920*3:]==b[880*1920*3:],'提示语修订改变了预定文字区外图形';assert a!=b;diffs.append({'card':id,'portion':n,'outsidePredeterminedROIIdentical':True,'beforeSha256':sha(paths[0]),'afterSha256':sha(paths[1])})
for r in records.values():
 assert sha(out/(r['id']+'-assembly.mp4'))==r['sha256']
 for frame in r['frames']+r.get('boundaryFrames',[]):assert sha(out/Path(frame['path']).name)==frame['sha256']
report={'status':'complete','version':'full-rough-v2','previousVersion':'full-rough-v1','records':list(records.values()),'noteClarification':{'onlyAffectedCards':['FH08','FH09','FH10'],'roiPredetermined':roi,'samples':diffs,'scope':'三个各段35/72/93%无损帧文字区对比，非逐帧；后继FH11-FH12转场另行重渲；其余11原产物保留'},'transitionCorrection':{'finding':'Rv2-1','card':'FH11-FH12','reason':'前14帧冻结上一段FH10末画面，因此须重渲消除旧提示语','boundaryFrames':[0,7,13,14],'sourceSnapshot':'render-sources/transition-correction','humanGate':'实际抽帧不代签全片终审'},'cardMetadataUpdate':'卡中角色/说明/确认范围更新不改变id、原声、旁白、帧長等实际被渲染字段，详见evidence','scope':'三次真实渲染各保留自己的源SHA；不是声称首次15媒体全部来自后续修改的同一源SHA'}
(out/'render-delivery.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print('15素材对应三批真实输出；3段文字修改的9个采样只在预定文字区域变化')
