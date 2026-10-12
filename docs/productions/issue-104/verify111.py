"""核对真实ClapGrid完整粗剪；提供开发证据，不代签正式验收或人工审阅。"""
from pathlib import Path
import argparse,array,hashlib,json,math,re,subprocess

EXPECTED_TEXT=[
'股骨头坏死，为什么可能让原本圆滑的关节面塌陷？',
'先看这里：大腿骨顶端的球形部分，就是股骨头。',
'它表面覆盖软骨，下面是支撑关节面的骨组织。',
'骨组织也是活的，需要血液不断送来氧气和营养。',
'当局部血液供应受损，这里的骨组织就可能发生坏死。',
'但细胞死亡，不等于原有的骨架马上消失。',
'此时，股骨头外形仍可能保持完整。',
'身体也会尝试修复受损区域。',
'修复涉及旧骨吸收和新骨形成，但不一定能恢复足够的支撑。',
'如果局部结构继续受损，承重时就可能出现细小骨折。',
'损伤进一步发展，关节面下方的骨组织可能失去支撑，表面发生局部下陷。',
'不过，并不是每个坏死的股骨头都会塌陷。',
'受损范围、位置等因素，都会影响进展。',
'所以，坏死说的是骨组织死亡。',
'塌陷说的是支撑结构失效后，外形发生了改变。']
VOICE={'speaker':'zh_female_vv_uranus_bigtts','speechRate':0}

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def command(args):return subprocess.check_output(args)
def probe(p):return json.loads(command(['ffprobe','-v','error','-count_frames','-show_streams','-show_format','-of','json',str(p)]))
def decode_audio(p):
 data=array.array('f');data.frombytes(command(['ffmpeg','-v','error','-xerror','-i',str(p),'-map','0:a:0','-ac','1','-ar','48000','-f','f32le','-']));return data
def correlation(a,b):
 assert len(b)>=len(a),'完整原声样本不能被截断'
 n=len(a);am=sum(a)/n;bm=sum(b[:n])/n
 av=sum((x-am)**2 for x in a);bv=sum((x-bm)**2 for x in b[:n]);assert av>0 and bv>0,'配音不能为空白'
 corr=sum((x-am)*(y-bm) for x,y in zip(a,b))/math.sqrt(av*bv)
 gain=math.sqrt(bv/av)
 return corr,gain

def verify(root,logs):
 output=root/'outputs/full-rough-v1.mp4';preview=root/'outputs/full-rough-v1.webm'
 assert output.is_file(),'尚缺本轮真实ClapGrid导出粗剪，历史原型不能代替'
 assert preview.is_file(),'尚缺同一真实导出任务的WebM预览'
 plan=json.loads((root/'full-inputs/current111.json').read_text())
 assert plan['version']=='full-rough-v1' and len(plan['segments'])==15
 assert [s['text'] for s in plan['segments']]==EXPECTED_TEXT,'不能遗漏、重复或回填旧稿'
 assert [s['order'] for s in plan['segments']]==list(range(1,16))
 assert len({s['segmentId'] for s in plan['segments']})==15
 assert plan['segments'][9]['cardPath']=='cards/FH10-slow.json' and plan['segments'][9]['reviewVersion']=='fh10-slow-v3'
 assert plan['segments'][10]['logicalCard']=='FH11–FH12' and plan['segments'][10]['cardPath']=='cards/FH11-FH12.json'
 mapping=json.loads((root/'segment-mapping.json').read_text())['segments']
 assert [s['segmentId'] for s in plan['segments']]==[s['segmentId'] for s in mapping]
 assert [s['text'] for s in plan['segments']]==[s['text'] for s in mapping]
 host=json.loads((root/'evidence/111-host-before.json').read_text())
 speech=json.loads((root/'evidence/111-speech-before.json').read_text())
 settings=json.loads((root/'evidence/111-settings-before.json').read_text())
 export=json.loads((root/'evidence/111-export-succeeded.json').read_text())
 assert speech['voice']==VOICE and len(speech['tasks'])==15 and len(speech['audio'])==15
 task=export['task'];assert task['id']==plan['exportTaskId'] and task['state']=='succeeded' and task['completed']==task['total']==15 and task['issues']==[] and task['warnings']==[]
 assert settings['settings']=={'codec':'libx264','fps':30,'fontFamily':'Noto Sans CJK SC','fontSize':48}
 assert settings['output']['width']==1920 and settings['output']['height']==1080 and settings['selectedFontAvailable']
 assert sha(output)==export['output']['mp4Sha256'] and sha(preview)==export['output']['webmSha256']
 after_host=json.loads((root/'evidence/111-host-after.json').read_text());after_speech=json.loads((root/'evidence/111-speech-after.json').read_text())
 assert host['segments']==after_host['segments'] and host['assets']==after_host['assets'] and host['instanceId']==after_host['instanceId']
 assert speech['voice']==after_speech['voice'] and speech['tasks']==after_speech['tasks'] and speech['audio']==after_speech['audio']
 resources=json.loads((root/'full-inputs/resources/resources111.json').read_text())
 for resource in resources['resources']:assert sha(root/resource['path'])==resource['sha256']
 results=[];total_samples=0;full=decode_audio(output);web_audio=decode_audio(preview)
 for item in plan['segments']:
  card=json.loads((root/item['cardPath']).read_text());segment=next(x for x in host['segments'] if x['id']==item['segmentId']);voice_task=next(x for x in speech['tasks'] if x['id']==item['taskId']);audio=next(x for x in speech['audio'] if x['taskId']==item['taskId'])
  assert card['segmentId']==item['segmentId'] and card['text']==item['text'] and card['voice']==VOICE and card['taskId']==item['taskId']
  assert segment['order']==item['order'] and segment['text']==item['text'] and segment['video']['assetId']==item['assetId'] and segment['video']['start']==item['assetStart']==0
  assert voice_task['state']=='succeeded' and voice_task['segmentId']==item['segmentId'] and audio['valid'] and audio['segmentId']==item['segmentId']
  assert voice_task['input']==audio['input']=={'text':item['text'],'voice':VOICE}
  raw_audio=root/item['audioPath'];picture=root/item['assemblyPath'];assert sha(raw_audio)==item['audioSha256'] and sha(picture)==item['assemblySha256']
  assert sha(root/(card.get('关联素材') or card['素材'])['assembly'])==item['assemblySha256'],'实际关联必须对应明确选择的纯画面版本'
  meta=probe(picture);v=next(x for x in meta['streams'] if x['codec_type']=='video');assert (v['width'],v['height'],v['r_frame_rate'])==(1920,1080,'30/1')
  assert [x['codec_type'] for x in meta['streams']]==['video'],'装配输入不能含旁白音轨或字幕流'
  original=decode_audio(raw_audio);assert len(original)==item['decodedAudioSamples48k'];duration=len(original)/48000
  assert abs(item['start']-total_samples/48000)<1/48000 and abs(item['end']-(total_samples+len(original))/48000)<1/48000
  corr,gain=correlation(original,full[total_samples:total_samples+len(original)])
  tail_samples=min(24000,len(original));tail_corr,tail_gain=correlation(original[-tail_samples:],full[total_samples+len(original)-tail_samples:total_samples+len(original)])
  assert tail_corr>.97 and .9<tail_gain<1.1,(item['logicalCard'],tail_corr,'句尾半秒应完整对应')
  assert corr>.97 and .9<gain<1.1,(item['logicalCard'],corr,gain,'原速完整样本应在精确累计时间位置保留')
  preview_corr,preview_gain=correlation(original,web_audio[total_samples:total_samples+len(original)])
  assert preview_corr>.97 and .9<preview_gain<1.1,(item['logicalCard'],preview_corr,'真实WebM也须完整原声同步')
  # 句尾完整样本和精确拼接点均被以上全span比较覆盖，不代替人工听审或ASR。
  results.append({'logicalCard':item['logicalCard'],'segmentId':item['segmentId'],'start':item['start'],'end':item['end'],'sourceSamples48k':len(original),'fullOutputSampleOffset48k':total_samples,'fullSpanCorrelation':corr,'rmsGainRatio':gain,'lastHalfSecondCorrelation':tail_corr,'lastHalfSecondGain':tail_gain,'previewFullSpanCorrelation':preview_corr,'previewGain':preview_gain,'inputProbe':meta})
  total_samples+=len(original)
 total=total_samples/48000;assert abs(total-plan['originalAudioTotal'])<1/48000 and abs(total-68.04)<.001
 output_reports=[]
 for p,size in [(output,(1920,1080)),(preview,(960,540))]:
  meta=probe(p);v=next(x for x in meta['streams'] if x['codec_type']=='video');assert (v['width'],v['height'])==size and v['r_frame_rate']==v['avg_frame_rate']=='30/1'
  assert v['pix_fmt']=='yuv420p' and any(x['codec_type']=='audio' for x in meta['streams'])
  assert abs(int(v['nb_read_frames'])/30-total)<1/30+.002,'按实际输出帧数允许不足一帧差异，不强求ceil'
  assert total-.001<=float(meta['format']['duration'])<=total+.1
  decoded=subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(p),'-f','null','-'],capture_output=True);assert decoded.returncode==0 and decoded.stderr==b''
  (logs/(p.stem+'-decode.log')).write_bytes(decoded.stderr)
  output_reports.append({'path':str(p.relative_to(root)),'sha256':sha(p),'probe':meta,'decodeReturncode':decoded.returncode,'decodeStderr':decoded.stderr.decode()})
 black=subprocess.run(['ffmpeg','-hide_banner','-v','info','-i',str(output),'-an','-vf','blackdetect=d=0:pix_th=0.08:pic_th=0.98','-f','null','-'],capture_output=True);assert black.returncode==0
 (logs/'111-blackdetect.log').write_bytes(black.stderr);black_events=re.findall(r'black_start:([^ ]+) black_end:([^ ]+) black_duration:([^\s]+)',black.stderr.decode());assert black_events==[],black_events
 source_contract=json.loads((root/'evidence/111-source-contract.json').read_text())
 for item in source_contract['files']:assert sha(root/item['path'])==item['sha256']
 if (root/'manifest.json').exists():
  manifest=json.loads((root/'manifest.json').read_text());assert manifest['version']=='full-rough-v1'
  assert not any(f['path']=='manifest.json' for f in manifest['files'])
  for f in manifest['files']:assert (root/f['path']).is_file() and sha(root/f['path'])==f['sha256'],f['path']
 return {'status':'development-evidence-passed','scope':'真实ClapGrid导出任务、15当前输入/明确版本、原声48k完整span精确累计对齐、媒体尺寸帧率/完整解码/黑帧与清单SHA；代码/单帧/人审边界另行处理','exportTaskId':task['id'],'originalAudioTotal':total,'sourceTotalSamples48k':total_samples,'fullDecodedSamples48k':len(full),'segments':results,'outputs':output_reports,'blackEvents':black_events,'limitations':['无旁白烧录字幕由明确素材角色/已审源码/实际素材字节对应及独立技术阅读核对，不能只凭无字幕流下结论','全span音轨核对不能代签发音听审或ASR','15个单帧观察不扩展为逐帧医学/字幕/节奏终审','本脚本是开发证据，正式验收由固定集成提交后执行']}

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('root',type=Path);parser.add_argument('--logs',type=Path,required=True);parser.add_argument('--report',type=Path);args=parser.parse_args();args.logs.mkdir(parents=True,exist_ok=True);result=verify(args.root,args.logs);content=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
 if args.report:args.report.write_text(content)
 else:print(content)
