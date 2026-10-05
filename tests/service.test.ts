import { beginEdit } from '../src/shared/client.js';
import { test } from 'node:test';
import { get } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../src/service/server.js';
import { statusSchema } from '../src/shared/contracts.js';

test('HTTP 查询共享业务层，静态面板与项目数据隔离，拒绝向查询接口写入', async (t) => {
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

test('HTTP 完成编辑才返回已提交快照，数据库占用时保存失败且重开保留原值', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-save-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const panelDirectory = join(root, 'panel');
  mkdirSync(panelDirectory);
  writeFileSync(join(panelDirectory, 'index.html'), 'ClapGrid');
  const projectDirectory = join(root, 'project');
  const service = await startService({ projectDirectory, panelDirectory, port: 0 });
  t.after(() => service.close());
  const post = async (path: string, body: unknown) => {
    const session = await beginEdit(service.url);
    try {
      return await fetch(`${service.url}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Edit-Token': session.token }, body: JSON.stringify(body),
      });
    } finally { await session.close(); }
  };
  const added = await post('/api/segments/add', { text: '原文' });
  assert.equal(added.status, 200);
  const initial = statusSchema.parse(await added.json());
  const id = initial.snapshot.segments[0]!.id;
  const edited = await post('/api/segments/edit', { id, text: '已保存文案' });
  assert.equal(edited.status, 200);
  assert.equal(statusSchema.parse(await edited.json()).snapshot.segments[0]!.text, '已保存文案');
  assert.equal((await post('/api/segments/edit', { id, text: '禁止任意状态', order: 5 })).status, 400);
  assert.equal((await fetch(`${service.url}/api/segments/add`, { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await fetch(`${service.url}/api/segments/add`, { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: '{"text":"入侵"}' })).status, 403);
  const { DatabaseSync } = await import('node:sqlite');
  const lock = new DatabaseSync(join(projectDirectory, 'clapgrid.sqlite'));
  try {
    lock.exec('BEGIN IMMEDIATE');
    const failed = await post('/api/segments/edit', { id, text: '保存失败的文案' });
    assert.equal(failed.status, 500);
    assert.match((await failed.json()).error, /保存失败/);
  } finally { lock.exec('ROLLBACK'); lock.close(); }
  const { openBusiness } = await import('../src/business/index.js');
  const reopened = openBusiness(projectDirectory);
  t.after(() => reopened.close());
  assert.equal(reopened.getSnapshot().segments[0]!.text, '已保存文案');
  assert.equal((await post('/api/segments/edit', { id, text: '恢复保存' })).status, 200);
});

test('旧服务实例的绑定地址不能在其他服务读取或修改项目', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-binding-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const panelDirectory = join(root, 'panel');
  mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'ClapGrid');
  const service = await startService({ projectDirectory: join(root, 'project'), panelDirectory, port: 0 });
  t.after(() => service.close());
  const response = await fetch(`${service.url}/binding/invalid/api/status`);
  assert.equal(response.status, 409);
});
