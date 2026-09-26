"""从固定归档生成带 Linux 安装入口的插件，不复制原型源码进主分支。"""
import argparse
import hashlib
import io
from pathlib import Path
import shutil
import subprocess
import zipfile

ARCHIVE = 'af22343add8bf9c0b779fc6e8e681ff7c3b069fe:prototypes/runtime-lifecycle/clapgrid-runtime-probe.zip'
SHA256 = '79d89ee26aca59032c59644ab10c75e4269e2e45d14e57c4963778c92dd77278'
source = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', type=Path, help='新建的输出目录；不能已存在')
args = parser.parse_args()
data = subprocess.check_output(['git', 'show', ARCHIVE], cwd=source.parents[3])
if hashlib.sha256(data).hexdigest() != SHA256:
    raise SystemExit('归档 ZIP 校验失败，未生成插件。')
args.output.mkdir(parents=True, exist_ok=False)
with zipfile.ZipFile(io.BytesIO(data)) as archive:
    archive.extractall(args.output)
plugin = args.output / 'clapgrid-runtime-probe'
for name in ('runtime-linux.sh', 'runtime_status.py'):
    shutil.copyfile(source / name, plugin / 'scripts' / name)
shutil.copyfile(source / 'SKILL.md', plugin / 'skills/clapgrid-runtime-probe/SKILL.md')
shutil.copyfile(source / 'plugin.json', plugin / '.codex-plugin/plugin.json')
with zipfile.ZipFile(args.output / 'clapgrid-runtime-probe.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(plugin.rglob('*')):
        if path.is_file():
            archive.write(path, path.relative_to(args.output))
print(plugin.resolve())
print((args.output / 'clapgrid-runtime-probe.zip').resolve())
