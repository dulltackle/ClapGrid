import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { build } from 'esbuild';
import { queryStatus } from '../src/shared/client.js';

test('打包后台入口重复启动复用同一项目，拒绝其他项目，停止后恢复原项目身份', { timeout: 30000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-runtime-'));
  const dist = join(root, 'dist'); const project = join(root, 'project');
  mkdirSync(join(dist, 'panel'), { recursive: true }); writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(dist, 'panel', 'index.html'), 'ClapGrid');
  await build({ entryPoints: ['src/runtime.ts', 'src/service/main.ts', 'src/business/media-worker.ts'], outbase: 'src', outdir: dist,
    bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['vite'],
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = (socket.address() as import('node:net').AddressInfo).port; await new Promise<void>(resolve => socket.close(() => resolve()));
  const url = `http://127.0.0.1:${port}`;
  const cli = async (action: string, directory = project) => JSON.parse((await promisify(execFile)(process.execPath,
    [join(dist, 'runtime.js'), action, '--project', directory, '--port', String(port)])).stdout);
  let pid: number | undefined;
  t.after(async () => {
    try { await cli('stop'); } catch { /* 已停止。 */ }
    if (pid) for (let attempt = 0; attempt < 200; attempt++) {
      try {
        process.kill(pid, 0);
        if (process.platform === 'linux' && readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]!.startsWith('Z')) break;
      } catch { break; }
      if (attempt === 199) throw new Error('后台服务尚未退出，保留临时项目');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    rmSync(root, { recursive: true, force: true });
  });
  const first = await cli('start');
  pid = first.pid;
  const again = await cli('start');
  assert.deepEqual([again.instanceId, again.pid, again.snapshot.project.id], [first.instanceId, first.pid, first.snapshot.project.id]);
  await assert.rejects(cli('start', join(root, 'other')), /属于其他项目/);
  assert.equal((await cli('status')).instanceId, first.instanceId);
  assert.equal((await cli('stop')).outcome, 'stopping');
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await queryStatus(url); } catch { break; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const reopened = await cli('start');
  pid = reopened.pid;
  assert.equal(reopened.snapshot.project.id, first.snapshot.project.id);
  assert.notEqual(reopened.instanceId, first.instanceId);
  assert.equal(reopened.taskLocked, false);
});
