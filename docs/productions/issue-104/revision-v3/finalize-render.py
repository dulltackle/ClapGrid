"""汇合两批实际输出；每段保留真实源码、位移图等待修订和生图依赖身份。"""
from pathlib import Path
import json,hashlib,sys
root=Path(sys.argv[1]);out=root/'revision-v3/outputs';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
first=json.loads((out/'render-complete.json').read_text());second=json.loads((out/'render-map-ready-correction.json').read_text());assert first['status']==second['status']=='complete' and first['version']==second['version']=='full-rough-v3'
assert second['selectedIds']==['FH11-FH12','FH13','FH14','FH16']
records={r['id']:dict(r,renderSourceIdentity=first['sourceBefore'],renderBatch='complete') for r in first['records']}
for r in second['records']:records[r['id']]=dict(r,renderSourceIdentity=second['sourceBefore'],renderBatch='map-ready-correction')
assert len(records)==15
for r in records.values():
 assert sha(out/(r['id']+'-assembly.mp4'))==r['sha256']
 for f in r['frames']+r.get('boundaryFrames',[]):assert sha(out/Path(f['path']).name)==f['sha256']
(out/'render-delivery.json').write_text(json.dumps({'status':'complete','version':'full-rough-v3','previousVersion':'full-rough-v2','records':list(records.values()),'mapReadinessCorrection':{'finding':'Rv3-1','affectedCards':second['selectedIds'],'reason':'动态数学位移场与feImage使用相同dataURI，Remotion Img显式等待每帧decode；涵盖当前下陷镜头与后继转场冻结前幕','sourceSnapshot':'render-sources/map-ready-correction','firstBatchPreserved':'外部run/v3-render-before-ready','scope':'不是声称已实测发现空白帧；修正未保证每帧资源就绪的边界'},'cardMetadataCorrection':{'finding':'Rv3-2','cards':['FH07','FH15'],'scope':'说明/标注与实际新源一致；原文、原声、稳定身份和时长不变'},'scope':'15段来自两批真实渲染，保留各自源码和生图原件SHA；固定提交正式检查、实际ClapGrid全片及完整用户审阅另记'},ensure_ascii=False,indent=2)+'\n')
print('15实际素材与两批真实渲染源身份已汇合')
