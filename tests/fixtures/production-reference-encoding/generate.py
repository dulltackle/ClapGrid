"""仅离线固定旧统一入口的证据语言成功包，不属于日常检查或运行回退。"""
import argparse, hashlib, json, os, platform, subprocess
from pathlib import Path

args = argparse.ArgumentParser()
args.add_argument('--old-tree', required=True)
args.add_argument('--minimum-python', required=True)
args.add_argument('--logs', required=True)
args.add_argument('--cases', help='仅生成新增组并追加来源；已有冻结组拒绝覆盖')
a = args.parse_args()
root = Path(__file__).resolve().parent
old = Path(a.old_tree).resolve()
logs = Path(a.logs).resolve()
logs.mkdir(parents=True, exist_ok=True)
node = '/usr/bin/node'
versions = [('3.14', '/usr/bin/python3'), ('3.12', a.minimum_python)]
encodings = [('utf8', 'utf-8'), ('utf8-bom', 'utf-8-sig'), ('utf16-le', 'utf-16-le'), ('utf16-be', 'utf-16-be'), ('utf16-le-bom', 'utf-16-le'), ('utf16-be-bom', 'utf-16-be'), ('utf32-le', 'utf-32-le'), ('utf32-be', 'utf-32-be'), ('utf32-le-bom', 'utf-32-le'), ('utf32-be-bom', 'utf-32-be'), ('constants', 'utf-8'), ('utf8-surrogatepass', 'utf-8')] + [(name, 'utf-8') for name in ['bigint-history','surrogate-history','string-constant-history','int-float-current','int-bool-current','null-missing-current','missing-null-current','structured-current','structured-history','nan-history','int-float-rounded-history','int-float-exact-current','paired-surrogate-history','paired-surrogate-nested-history','escaped-surrogate-current','paired-key-history','paired-key-current']] + [('paired-surrogate32-history','utf-32-le'),('paired-surrogate16-current','utf-16-le')]
encodings += [(name, 'utf-8') for name in ['key-order-history','key-order-nested-history','key-order-current']]
selected = set(a.cases.split(',')) if a.cases else None
if selected:
    if selected - {name for name, _ in encodings}: raise ValueError('未知组')
    encodings = [(name, encoding) for name, encoding in encodings if name in selected]
boms = {'utf16-le-bom': b'\xff\xfe', 'utf16-be-bom': b'\xfe\xff', 'utf32-le-bom': b'\xff\xfe\0\0', 'utf32-be-bom': b'\0\0\xfe\xff'}
sha = lambda b: hashlib.sha256(b).hexdigest()
sources = {}
for name in ['scripts/production.mjs','scripts/production/common.mjs','scripts/production/package-common.mjs','scripts/production/archive.py']:
    sources[name] = sha((old / name).read_bytes())
catalog = {'purpose': '独立旧统一Node+Python入口实际成功编码包；不是新Node互相证明', 'source': {'oldCommit': subprocess.check_output(['git','-C',str(old),'rev-parse','HEAD'],text=True).strip(), 'oldTree':str(old), 'files':sources, 'generatorSha256':sha(Path(__file__).read_bytes())}, 'node':subprocess.check_output([node,'--version'],text=True).strip(), 'platform':platform.platform(), 'cases':[]}
for name, encoding in encodings:
    directory = root / name
    if selected and directory.exists(): raise ValueError('拒绝覆盖冻结组：' + name)
    project = directory / 'project'
    project.mkdir(parents=True, exist_ok=True)
    proof = '原件NaN Infinity -Infinity😀.json'
    contents = {'source.ts': b'export const scene = 1;\n', 'card.json': b'{"segments":[{"id":"A","source":"source.ts","audio":"audio.wav"}]}', 'audio.wav': b'controlled-audio', 'assembly.mp4': b'controlled-assembly', 'review.mp4': b'controlled-review', 'tsconfig.json': b'{}', proof: '技术原件😀；受控测试，不是真实用户结论'.encode('utf8')}
    review_version = 'current'
    evidence = {'reviewVersion': review_version, 'requirements': [], 'records': [{'reviewVersion': review_version, 'artifact': {'path': proof}, 'provenance': {'record': proof}}, {'reviewVersion': 'historical', 'artifact': {'path':'历史😀.json'}, 'provenance': {'record':'历史😀.json'}}], 'unknownExtension': {'path':'扩展😀.json','text':'NaN Infinity -Infinity', 'NaN':'Infinity'}}
    if name == 'constants': evidence['unknownExtension'].update({'metric':float('nan'), 'overflow':float('inf'), 'negative':-float('inf'), 'markerLiteral':0.0})
    selections = {
        'paired-surrogate-history': ('😀', '\ud83d\ude00'),
        'paired-surrogate32-history': ('😀', '\ud83d\ude00'),
        'paired-surrogate16-current': ('😀', '\ud83d\ude00'),
        'paired-surrogate-nested-history': ({'value':['😀']}, {'value':['\ud83d\ude00']}),
        'escaped-surrogate-current': ('😀', 'RAW_ESCAPED_PAIR'),
        'paired-key-history': ({'😀':1}, {'\ud83d\ude00':1}),
        'paired-key-current': ({'\ud83d\ude00':1}, {'\ud83d\ude00':1}),
        'bigint-history': (9007199254740993, 9007199254740992),
        'surrogate-history': ('\ud800', '\ud801'),
        'string-constant-history': ('NaN', float('nan')),
        'int-float-current': (1, 1.0), 'int-bool-current': (1, True),
        'null-missing-current': (None, None), 'missing-null-current': (None, None),
        'structured-current': ({'nested':[1,float('nan'),{'x':True}]}, {'nested':[1.0,float('nan'),{'x':1}]}),
        'structured-history': ({'nested':[1,float('nan'),{'x':True}]}, {'nested':[1.0,float('nan'),{'x':0}]}),
        'nan-history': (float('nan'),float('nan')),
        'int-float-rounded-history': (9007199254740993, float(9007199254740993)),
        'int-float-exact-current': (9007199254740992, float(9007199254740992)),
    }
    if name in selections:
        evidence['reviewVersion'], evidence['records'][0]['reviewVersion'] = selections[name]
        if name == 'null-missing-current': del evidence['records'][0]['reviewVersion']
        if name == 'missing-null-current': del evidence['reviewVersion']
    if name.startswith('key-order-'):
        evidence['reviewVersion'] = 'RAW_DUPLICATE_KEYS'
        evidence['records'][0]['reviewVersion'] = {'\ud800': 3 if name.endswith('current') else 2}
        if name == 'key-order-nested-history': evidence['records'][0]['reviewVersion'] = {'nested': [evidence['records'][0]['reviewVersion']]}
    if name == 'utf8-surrogatepass': evidence['unknownExtension']['surrogate'] = '\ud800'
    text = json.dumps(evidence, ensure_ascii=False, separators=(',',':'))
    if name == 'escaped-surrogate-current': text = text.replace('\"RAW_ESCAPED_PAIR\"', '\"\\ud83d\\ude00\"')
    if name.startswith('key-order-'):
        duplicate = '{"\ud800":1,"\\ud800":2,"\ud800":3}'
        if name == 'key-order-nested-history': duplicate = '{"nested":[' + duplicate + ']}'
        text = text.replace('"RAW_DUPLICATE_KEYS"', duplicate)
    raw = text.encode(encoding, 'surrogatepass')
    contents['evidence.json'] = boms.get(name,b'') + raw
    for path, data in contents.items(): (project / path).write_bytes(data)
    decoded = json.loads(contents['evidence.json'])
    requires_proof = decoded['records'][0].get('reviewVersion') == decoded.get('reviewVersion')
    manifest = {'schemaVersion':1, 'project':{'width':64,'height':64,'fps':10},'typecheck':'tsconfig.json','evidence':'evidence.json', 'segments':[{'id':'A','card':'card.json','source':'source.ts','audio':'audio.wav','assembly':'assembly.mp4','review':'review.mp4','frames':1}], 'files':[{'path':path,'category':'technical' if path in [proof,'evidence.json'] else 'production','sha256':sha(data)} for path,data in contents.items() if path != proof or requires_proof]}
    (project / 'production.json').write_bytes((json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode('utf8'))
    case = {'name':name,'encoding':encoding,'proof':proof,'requiresProof':requires_proof,'identities':[{'path':path,'sha256':sha((project / path).read_bytes()),'size':len((project / path).read_bytes())} for path in [*contents,'production.json']], 'versions':[]}
    for version, python in versions:
        env = {**os.environ,'PATH':str(Path(python).parent)+os.pathsep+os.environ['PATH']}
        executable_version = subprocess.check_output(['python3','--version'],env=env,text=True).strip()
        archive = directory / ('legacy-'+version+'.tar.gz')
        results = []
        for command in ['pack','verify-package']:
            report = logs / (name+'-'+version+'-'+command+'.json')
            params = [node,str(old/'scripts/production.mjs'),command,'--project',str(project),'--report',str(report), '--output' if command=='pack' else '--archive',str(archive)]
            process = subprocess.run(params,env=env,capture_output=True,text=True)
            result = {'command':params,'environment':{'PATH':env['PATH'],'python':executable_version},'exit':process.returncode,'stdout':process.stdout,'stderr':process.stderr,'report':json.loads(report.read_text())}
            results.append(result)
            if process.returncode: raise RuntimeError(result)
        case['versions'].append({'python':executable_version,'archive':archive.name,'sha256':sha(archive.read_bytes()),'size':archive.stat().st_size,'results':results})
    catalog['cases'].append(case)
if selected:
    previous = json.loads((root/'catalog.json').read_text())
    previous.setdefault('generations', []).append({**{key: catalog[key] for key in ['source','node','platform']}, 'caseNames': [case['name'] for case in catalog['cases']], 'note':'仅新增组；已有冻结来源及字节完全保留'})
    previous['cases'].extend(catalog['cases'])
    catalog = previous
(root/'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'cases':len(catalog['cases']),'versions':len(versions),'oldCommit':catalog['source']['oldCommit'],'generatorSha256':catalog['source']['generatorSha256'],'platform':catalog['platform']},ensure_ascii=False))
