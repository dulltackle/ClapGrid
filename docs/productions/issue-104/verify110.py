"""档案恢复边界：完整校验、现行输入和完成记录分别判断，不改原档案。"""
import pathlib,json,hashlib,argparse,subprocess

def check_roles(root,card,manifest,observations):
 if card is None:return {'status':'待核对','reason':'制作卡缺失'}
 expected={'assembly':f"outputs/{card['id']}-assembly.mp4",'review':f"outputs/{card['id']}-review.mp4"}
 checks=[]
 checks.append({'check':'制作卡按本版id对应装配/审阅路径','passed':card.get('关联素材')==expected,'expected':expected,'actual':card.get('关联素材')})
 checks.append({'check':'清单装配对应本版','passed':manifest['assembly']==expected['assembly']})
 # 从实际渲染记录验证产物身份、动作及输入；版本/关联字段是后续说明，不回写历史渲染快照。
 meta=root/f"outputs/{card['id']}-render.json"
 good=lambda path:any(o['path']==path and o['status']=='可复用' for o in observations)
 try:
  rendered=json.loads(meta.read_text());keys=['id','segmentId','text','voice','taskId','audioSha256','durationInFrames','motion']
  checks.append({'check':'实际渲染记录身份/输入/动作与本卡匹配','passed':good(str(meta.relative_to(root))) and all(rendered['card'].get(k)==card.get(k) for k in keys) and rendered['outputs'][:2]==[expected['assembly'].split('/')[-1],expected['review'].split('/')[-1]]})
 except (OSError,ValueError,KeyError):checks.append({'check':'实际渲染记录可读取','passed':False})
 for role,path in expected.items():
  p=root/path;passed=False;summary=None
  if p.is_file() and good(path):
   try:
    meta=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(p)],stderr=subprocess.PIPE));video=next(s for s in meta['streams'] if s['codec_type']=='video');has_audio=any(s['codec_type']=='audio' for s in meta['streams']);passed=(video['width'],video['height'],video['r_frame_rate'])==(1920,1080,'30/1') and has_audio==(role=='review') and card['audioDuration']<=float(meta['format']['duration'])<=card['audioDuration']+1/30+.002;summary={'width':video['width'],'height':video['height'],'fps':video['r_frame_rate'],'hasAudio':has_audio,'duration':meta['format']['duration']}
   except (subprocess.CalledProcessError,ValueError,KeyError,StopIteration):pass
  checks.append({'check':f'实际{role}文件角色/规格/时长正确且匹配清单SHA','path':path,'passed':passed,'probe':summary})
 return {'status':'可复用' if all(c['passed'] for c in checks) else '待核对','checks':checks}

def assess(root,current):
 manifest=json.loads((root/'manifest.json').read_text())
 observations=[]
 for entry in manifest['files']:
  p=root/entry['path']
  state='可复用' if p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest()==entry['sha256'] else '待核对'
  observations.append({'path':entry['path'],'status':state,'reason':'文件完整且校验匹配' if state=='可复用' else '文件缺失或校验不匹配'})
 card_path=root/manifest['card'];card_good=next(o['status']=='可复用' for o in observations if o['path']==manifest['card'])
 card=json.loads(card_path.read_text()) if card_path.is_file() else None
 expected=manifest['input'] if current is None else current
 audio=root/manifest['audio']
 input_ok=card_good and card is not None and {k:card.get(k) for k in ['segmentId','text','voice','taskId','audioSha256']}==expected and audio.is_file() and hashlib.sha256(audio.read_bytes()).hexdigest()==expected['audioSha256']
 done=root/manifest['completionRecord'];completion_ok=False
 if done.is_file() and next(o['status']=='可复用' for o in observations if o['path']==manifest['completionRecord']):
  completion=json.loads(done.read_text());completion_ok=completion.get('status')=='complete' and completion.get('version')==manifest['version'] and completion.get('input')==manifest['input']
 # 已校验的源/字体/参考仍可复用；输入不匹配使配音/字幕/成片待核对。
 if not input_ok:
  for o in observations:
   if o['path']==manifest['card'] or o['path'].startswith('outputs/') or o['path']==manifest['audio']:
    o.update(status='待核对',reason='当前稳定身份/文案/声音/任务/音频输入不匹配')
 if not completion_ok:
  for o in observations:
   if o['path'].startswith('outputs/') or o['path']==manifest['completionRecord']:
    o.update(status='待核对',reason='缺失、损坏或未完成的制作完成记录')
 roles=check_roles(root,card,manifest,observations)
 if roles['status']!='可复用':
  for o in observations:
   if o['path']==manifest['card'] or o['path'].startswith('outputs/'):
    o.update(status='待核对',reason='本版素材角色映射或实际产物核对失败')
 complete=input_ok and completion_ok and roles['status']=='可复用' and all(o['status']=='可复用' for o in observations)
 return {'archive':str(root),'version':manifest['version'],'status':'可复用' if complete else '待核对','inputMatches':input_ok,'completionMatches':completion_ok,'roleMapping':roles,'files':observations,'scope':'当前实际文件、校验、输入、完成记录及本版实物角色；不继承新增人工审阅，不等于项目已接回'}

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('archive');parser.add_argument('--current-input');parser.add_argument('--report');args=parser.parse_args()
 result=assess(pathlib.Path(args.archive),json.loads(pathlib.Path(args.current_input).read_text()) if args.current_input else None)
 encoded=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
 if args.report:pathlib.Path(args.report).write_text(encoded)
 print(encoded)
 raise SystemExit(0 if result['status']=='可复用' else 1)
