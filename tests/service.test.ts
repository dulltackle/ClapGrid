import { test } from 'node:test';
import { get } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../src/service/server.js';
import { statusSchema } from '../src/shared/contracts.js';

test('HTTP 查询共享业务层，静态面板与项目数据隔离，只开放只读接口', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-http-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const panelDirectory = join(root, 'panel');
  mkdirSync(panelDirectory);
  writeFileSync(join(panelDirectory, 'index.html'), '<title>ClapGrid</title>');
  const service = await startService({ projectDirectory: join(root, 'project'), panelDirectory, port: 0 });
  t.after(() => service.close());
  const status = statusSchema.parse(await (await fetch(`${service.url}/api/status`)).json());
  assert.equal(status.snapshot.project.directory, join(root, 'project'));
  assert.deepEqual(status.snapshot.segments, []);
  assert.match(await (await fetch(service.url)).text(), /ClapGrid/);
  assert.equal((await fetch(`${service.url}/api/status`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${service.url}/clapgrid.sqlite`)).status, 404);
  assert.equal((await fetch(`${service.url}/api/status`, { headers: { Origin: 'https://example.com' } })).status, 403);
  const foreignHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    get(`${service.url}/api/status`, { headers: { Host: 'evil.example' } }, response => {
      response.resume(); resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
});

test('异常请求路径返回 400，服务仍能查询项目状态', { timeout: 3000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-invalid-url-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const panelDirectory = join(root, 'panel');
  mkdirSync(panelDirectory);
  writeFileSync(join(panelDirectory, 'index.html'), 'ClapGrid');
  const service = await startService({ projectDirectory: join(root, 'project'), panelDirectory, port: 0 });
  t.after(() => service.close());
  const statusCode = await new Promise<number | undefined>((resolve, reject) => {
    const request = get(service.url, { path: '//[' }, response => {
      response.resume(); resolve(response.statusCode);
    });
    request.setTimeout(500, () => request.destroy(new Error('异常请求没有收到响应。')));
    request.on('error', reject);
  });
  assert.equal(statusCode, 400);
  assert.equal((await fetch(`${service.url}/api/status`)).status, 200);
});
