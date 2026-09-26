"""只查询原型状态，绝不启动服务或任务。"""
import argparse
import json
from pathlib import Path
import sys
import tempfile
import urllib.error
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=48761)
parser.add_argument('--project', default=str(Path(tempfile.gettempdir()) / 'clapgrid-PROTOTYPE-wipe-me'))
args = parser.parse_args()
url = f'http://127.0.0.1:{args.port}'
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
try:
    with opener.open(url + '/state', timeout=3) as response:
        state = json.load(response)
    if not isinstance(state, dict) or state.get('identity') != 'clapgrid-runtime-PROTOTYPE' or state.get('project') != str(Path(args.project).resolve()):
        raise ValueError('端口服务身份或项目不匹配，请保留原服务并检查参数')
except (OSError, ValueError, urllib.error.URLError) as error:
    print(f'未确认目标服务在线：{error}。本次仅查询，没有启动服务或任务。', file=sys.stderr)
    sys.exit(20)
print(json.dumps({'url': url, 'state': state}, ensure_ascii=False))
