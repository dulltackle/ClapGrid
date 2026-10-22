import { test } from './helpers/resource-test.js';
import { vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { build } from 'esbuild';
import { serviceProcess, waitForServiceExit } from './helpers/service-exit.js';
import { queryStatus } from '../src/shared/client.js';

test('打包后台入口重复启动复用同一项目，拒绝其他项目，停止后恢复原项目身份', { timeout: 30000 }, async ({ createDirectory, execCommand, ownProcess }) => {
  const root = createDirectory(join(tmpdir(), 'clapgrid-runtime-'));
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
  const cli = async (action: string, directory = project) => JSON.parse((await execCommand(process.execPath,
    [join(dist, 'runtime.js'), action, '--project', directory, '--port', String(port)])).stdout);
  let pid: number | undefined;

  const first = await cli('start');
  pid = first.pid;
  const firstProcess = serviceProcess(first.pid); ownProcess(() => firstProcess);
  const again = await cli('start');
  assert.deepEqual([again.instanceId, again.pid, again.snapshot.project.id], [first.instanceId, first.pid, first.snapshot.project.id]);
  await assert.rejects(cli('start', join(root, 'other')), /属于其他项目/);
  assert.equal((await cli('status')).instanceId, first.instanceId);
  assert.equal((await cli('stop')).outcome, 'stopping');
  await waitForServiceExit(firstProcess);
  const reopened = await cli('start');
  pid = reopened.pid; ownProcess(() => serviceProcess(reopened.pid));
  assert.equal(reopened.snapshot.project.id, first.snapshot.project.id);
  assert.notEqual(reopened.instanceId, first.instanceId);
  assert.equal(reopened.taskLocked, false);
});
