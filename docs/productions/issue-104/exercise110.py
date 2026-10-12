"""在独立完整档案副本中操作文件和当前输入，通过公开CLI验证待核对边界。"""
import pathlib,argparse,json,shutil,subprocess,sys
parser=argparse.ArgumentParser();parser.add_argument('archive');parser.add_argument('destination');parser.add_argument('--report',required=True);args=parser.parse_args();base=pathlib.Path(args.archive);dest=pathlib.Path(args.destination);dest.mkdir(parents=True,exist_ok=True)
verifier=pathlib.Path(__file__).with_name('verify110.py');manifest=json.loads((base/'manifest.json').read_text());results=[]
for case in ['missing-audio','checksum-mismatch','text-mismatch','voice-mismatch','missing-completion']:
 root=dest/case
 if root.exists():raise RuntimeError(f'保留既有演练目录，不覆盖：{root}')
 shutil.copytree(base,root,ignore=shutil.ignore_patterns('node_modules','bundle'))
 current=None
 if case=='missing-audio':(root/manifest['audio']).unlink()
 elif case=='checksum-mismatch':
  target=root/manifest['assembly'];data=target.read_bytes();target.write_bytes(bytes([data[0]^1])+data[1:])
 elif case in ['text-mismatch','voice-mismatch']:
  current=dict(manifest['input'])
  if case=='text-mismatch':current['text']='这是中断演练的模拟不匹配文案。'
  else:current['voice']={**current['voice'],'speechRate':1}
  current_file=root/'110-simulated-current-input.json';current_file.write_text(json.dumps(current,ensure_ascii=False,indent=2)+'\n')
 else:(root/manifest['completionRecord']).unlink()
 command=[sys.executable,str(verifier),str(root)]
 if current is not None:command+=['--current-input',str(current_file)]
 check=subprocess.run(command,capture_output=True,text=True);assert check.returncode==1,check.stderr
 result=json.loads(check.stdout);assert result['status']=='待核对';assert any(o['status']=='待核对' for o in result['files']);assert any(o['status']=='可复用' for o in result['files'])
 results.append({'case':case,'command':command,'exitCode':check.returncode,'result':result})
original=subprocess.run([sys.executable,str(verifier),str(base)],capture_output=True,text=True,check=True);assert json.loads(original.stdout)['status']=='可复用'
report={'status':'passed','scope':'五个独立物理副本；原档案恢复检查仍通过；未连接或修改ClapGrid项目','originalArchive':str(base),'cases':results};pathlib.Path(args.report).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print('缺文件/校验错/文案错/声音错/无完成记录均待核对，完整匹配部分可复用，原档案仍通过。')
