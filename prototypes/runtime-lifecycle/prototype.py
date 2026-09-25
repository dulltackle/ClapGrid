"""一次性运行能力原型；只使用模拟任务与专用临时项目。"""
import argparse
import copy
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser()
parser.add_argument('--serve', action='store_true')
parser.add_argument('--port', type=int, default=48761)
parser.add_argument('--project', default=str(Path(tempfile.gettempdir()) / 'clapgrid-PROTOTYPE-wipe-me'))
args = parser.parse_args()
root = Path(args.project).resolve()
url = f'http://127.0.0.1:{args.port}'
identity = 'clapgrid-runtime-PROTOTYPE'
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def existing():
    try:
        with opener.open(url + '/state', timeout=1) as response:
            value = json.load(response)
        if value['identity'] != identity or value['project'] != str(root):
            raise RuntimeError('此端口属于其他服务或项目，请选择其他 --port')
        return value
    except (urllib.error.URLError, TimeoutError):
        return None

if not args.serve:
    if not existing():
        root.mkdir(parents=True, exist_ok=True)
        options = {'start_new_session': True} if os.name != 'nt' else {
            'creationflags': subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP}
        with (root / 'service.log').open('ab') as log:
            subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--serve',
                              '--port', str(args.port), '--project', str(root)],
                             stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                             close_fds=True, **options)
        for _ in range(50):
            if existing():
                break
            time.sleep(.1)
        else:
            raise SystemExit(f'启动失败，请查看 {root / "service.log"}')
    print(json.dumps({'url': url, 'state': existing()}, ensure_ascii=False))
    raise SystemExit()

root.mkdir(parents=True, exist_ok=True)
file = root / 'PROTOTYPE-state.json'
lock = threading.RLock()
state = {'rows': ['这是第一段测试文案。', '这是第二段测试文案。'], 'task': None}

def save(value):
    temp = file.with_suffix('.tmp')
    with temp.open('w', encoding='utf-8') as output:
        json.dump(value, output, ensure_ascii=False, indent=2)
        output.flush()
        os.fsync(output.fileno())
    temp.replace(file)

def running():
    return bool(state['task'] and state['task']['status'] == '运行中')

def snapshot():
    return {**copy.deepcopy(state), 'identity': identity, 'project': str(root),
            'pid': os.getpid(), 'locked': running(), 'time': time.time()}

def worker(task_id):
    while True:
        time.sleep(1)
        with lock:
            if not running() or state['task']['id'] != task_id:
                return
            candidate = copy.deepcopy(state)
            candidate['task']['progress'] += 1
            if candidate['task']['progress'] >= candidate['task']['seconds']:
                candidate['task']['status'] = '已完成'
            try:
                save(candidate)
            except OSError:
                state['task']['status'] = '保存失败，任务已停止'
                return
            state.update(candidate)

class Handler(BaseHTTPRequestHandler):
    def reply(self, status, value, mime='application/json; charset=utf-8'):
        data = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == '/state':
            with lock:
                self.reply(200, snapshot())
        elif self.path == '/':
            self.reply(200, Path(__file__).with_name('index.html').read_bytes(), 'text/html; charset=utf-8')
        elif self.path in ('/sample.mp4', '/preview.webm'):
            media = Path(__file__).with_name(self.path[1:])
            if not media.exists():
                return self.reply(404, {'error': '尚未生成测试视频'})
            data = media.read_bytes()
            span = self.headers.get('Range')
            if span:
                try:
                    begin, end = span.removeprefix('bytes=').split('-')
                    begin, end = int(begin), int(end) if end else len(data)-1
                    end = min(end, len(data)-1)
                    if begin < 0 or begin > end:
                        raise ValueError()
                except ValueError:
                    return self.reply(416, {'error': '无效范围'})
                self.send_response(206)
                self.send_header('Content-Range', f'bytes {begin}-{end}/{len(data)}')
                data = data[begin:end+1]
            else:
                self.send_response(200)
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Type', 'video/webm' if self.path.endswith('.webm') else 'video/mp4')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            self.reply(404, {'error': '不存在'})

    def do_POST(self):
        # 仅接受同源页面或明确使用 JSON 的本机验证请求。
        if self.headers.get('Origin', url) != url or self.headers.get('Content-Type') != 'application/json':
            return self.reply(403, {'error': '仅允许同源 JSON 请求'})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))))
            with lock:
                candidate = copy.deepcopy(state)
                if self.path == '/edit':
                    if running():
                        return self.reply(409, {'error': '后台任务持有项目锁，不能编辑'})
                    if not isinstance(body['text'], str):
                        raise ValueError()
                    candidate['rows'][int(body['row'])] = body['text']
                elif self.path == '/start':
                    if running():
                        return self.reply(409, {'error': '已有后台任务，未重复创建', **snapshot()})
                    candidate['task'] = {'id': str(uuid.uuid4()), 'status': '运行中',
                                         'seconds': max(5, min(900, int(body.get('seconds', 180)))), 'progress': 0}
                elif self.path == '/stop':
                    if running() and body.get('interrupt') is not True:
                        return self.reply(409, {'error': '任务仍在运行，保持服务；须明确选择中断任务并退出'})
                    if running():
                        candidate['task']['status'] = '已中断'
                else:
                    return self.reply(404, {'error': '不存在'})
                save(candidate)
                state.update(candidate)
                self.reply(200, snapshot())
                if self.path == '/start':
                    threading.Thread(target=worker, args=(state['task']['id'],), daemon=True).start()
                elif self.path == '/stop':
                    threading.Thread(target=server.shutdown, daemon=True).start()
        except (ValueError, KeyError, IndexError, TypeError):
            self.reply(400, {'error': '无效输入'})
        except OSError as error:
            self.reply(500, {'error': f'保存失败：{error}'})

# 先绑定端口，只有唯一获胜的进程可以读取和恢复状态。
server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
if file.exists():
    state = json.loads(file.read_text(encoding='utf-8'))
    if running():
        state['task']['status'] = '已中断'
save(state)
server.serve_forever()
server.server_close()
