"""离线经两个真实旧统一入口生成清单编码夹具；日常测试不调用 Python。"""
import argparse, hashlib, json, os, shutil, subprocess, tarfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--old-tree', required=True)
parser.add_argument('--minimum-python', required=True)
parser.add_argument('--logs', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent
old = Path(args.old_tree).resolve()
logs = Path(args.logs).resolve(); logs.mkdir(parents=True, exist_ok=True)
base = root.parent / 'production-archive-v1' / 'project'
raw = (base / 'production.json').read_bytes()
lone = bytes.fromhex('eda080'); pair = bytes.fromhex('eda0bdedb880')
cases = [
    ('unused-lone', raw[:-2] + b',"unusedRoot":"' + lone + b'"}\n', True),
    ('unused-pair', raw[:-2] + b',"unusedRoot":"' + pair + b'"}\n', True),
    ('overwritten-size-lone', raw.replace(b'"size":999', b'"size":"'+lone+b'"'), True),
    ('overwritten-size-pair', raw.replace(b'"size":999', b'"size":"'+pair+b'"'), True),
    ('unused-pair-selected-scalar', raw[:-2] + b',"unusedRoot":"'+pair+b'"}\n', True),
    ('escaped-pair', raw.replace('中文😀'.encode(), b'\xe4\xb8\xad\xe6\x96\x87\\ud83d\\ude00'), True),
    ('duplicate-invalid-overwritten', raw.replace(b'"extensions":{', b'"extensions":{"extra":"'+pair+b'","extra":"safe",'), True),
    ('selected-lone', raw.replace(b'"extensions":{', b'"extensions":{"extra":"'+lone+b'",'), False),
    ('selected-pair', raw.replace(b'"extensions":{', b'"extensions":{"extra":"'+pair+b'",'), False),
    ('selected-pair-key', raw.replace(b'"extensions":{', b'"extensions":{"'+pair+b'":1,'), False),
    ('selected-mixed-pair', raw.replace(b'"extensions":{', b'"extensions":{"extra":"'+bytes.fromhex('eda0bd')+b'\\ude00",'), False),
]
sha = lambda data: hashlib.sha256(data).hexdigest()
catalog = {'source': {'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=old,text=True).strip(), 'entry':str(old/'scripts/production.mjs'), 'archiveSha256':sha((old/'scripts/production/archive.py').read_bytes()), 'generatorSha256':sha(Path(__file__).read_bytes())}, 'cases':[]}
for name, manifest, success in cases:
    directory = root / name; project = directory / 'project'
    shutil.copytree(base, project)
    (project / 'production.json').write_bytes(manifest)
    case = {'name':name,'success':success,'manifestSha256':sha(manifest),'versions':[]}
    for label, python in [('3.14','/usr/bin/python3'),('3.12',args.minimum_python)]:
        env = {**os.environ,'PATH':str(Path(python).parent)}
        archive = directory / ('legacy-'+label+'.tar.gz')
        record = {'python':subprocess.check_output([python,'--version'],text=True).strip(),'results':[]}
        for command in ['pack','verify-package']:
            report = logs / (name+'-'+label+'-'+command+'.json')
            argv = ['/usr/bin/node',str(old/'scripts/production.mjs'),command,'--project',str(project),'--report',str(report),'--output' if command=='pack' else '--archive',str(archive)]
            run = subprocess.run(argv,env=env,capture_output=True,text=True)
            result = {'argv':argv,'PATH':env['PATH'],'exit':run.returncode,'stdout':run.stdout,'stderr':run.stderr,'report':json.loads(report.read_text())}
            record['results'].append(result)
            if (run.returncode == 0) != success: raise RuntimeError(result)
        if success:
            with tarfile.open(archive) as stream:
                index = stream.extractfile('.clapgrid-package.json').read()
            expected = directory / 'expected-index.json'
            if expected.exists(): assert expected.read_bytes() == index
            else: expected.write_bytes(index)
            record.update(archive=archive.name,archiveSha256=sha(archive.read_bytes()),indexSha256=sha(index))
        else: assert not archive.exists()
        case['versions'].append(record)
    catalog['cases'].append(case)
(root / 'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
