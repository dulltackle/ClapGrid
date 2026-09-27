import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../src/service/server.js';

async function fixture(t: import('node:test').TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-modification-'));
  const panelDirectory = join(root, 'panel');
  mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'ClapGrid');
  const service = await startService({ projectDirectory: join(root, 'project'), panelDirectory, port: 0 });
  t.after(async () => { await service.close(); rmSync(root, { recursive: true, force: true }); });
  const post = (path: string, body: unknown, token?: string) => fetch(`${service.url}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Edit-Token': token } : {}) }, body: JSON.stringify(body),
  });
  const status = async () => (await fetch(`${service.url}/api/status`)).json();
  return { service, post, status };
}

test('用户编辑期间拒绝 Codex 和无修改权保存，取消后立即可修改，旧连接不释放新修改权', async t => {
  const { service, post, status } = await fixture(t);
  const controller = new AbortController();
  const session = await fetch(`${service.url}/api/edit-session`, { method: 'POST', signal: controller.signal });
  assert.equal(session.status, 200);
  const reader = session.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  const { token } = JSON.parse(first.trim());
  assert.equal((await status()).modification.owner, 'user');
  assert.equal((await post('/api/codex/modify', { changes: [{ kind: 'add', text: '不得排队' }] })).status, 409);
  assert.equal((await post('/api/segments/add', { text: '无修改权' })).status, 409);
  assert.equal((await post('/api/edit-session/release', {}, token)).status, 200);
  controller.abort();
  const result = await post('/api/codex/modify', { changes: [{ kind: 'add', text: '成功' }] });
  assert.equal(result.status, 200);
  assert.deepEqual((await status()).snapshot.segments.map((s: { text: string }) => s.text), ['成功']);
  assert.equal((await status()).modification, null);
});

test('Codex 收到写请求即占用修改权，查询不受阻；中断及格式异常后释放', async t => {
  const { request } = await import('node:http');
  const { service, post, status } = await fixture(t);
  const pending = request(`${service.url}/api/codex/modify`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  pending.on('error', () => {});
  pending.write('{"changes":');
  t.after(() => pending.destroy());
  for (let i = 0; i < 50 && !(await status()).modification; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual((await status()).modification, { owner: 'codex' });
  assert.equal((await fetch(`${service.url}/api/edit-session`, { method: 'POST' })).status, 409);
  assert.equal((await post('/api/codex/modify', { changes: [{ kind: 'add', text: '不排队' }] })).status, 409);
  pending.destroy();
  for (let i = 0; i < 50 && (await status()).modification; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await status()).modification, null);
  assert.equal((await post('/api/codex/modify', { changes: [{ kind: 'edit', text: '缺少快照' }] })).status, 400);
  assert.equal((await status()).modification, null);
});

test('持有修改权重读目标：返回变化信息、跳过删除目标，其余逐项提交且不覆盖新文案', async t => {
  const { post, status } = await fixture(t);
  const batch = async (changes: unknown[]) => {
    const response = await post('/api/codex/modify', { changes });
    assert.equal(response.status, 200);
    return response.json();
  };
  await batch(['原文', '将删除', '继续处理'].map(text => ({ kind: 'add', text })));
  const [changed, deleted, valid] = (await status()).snapshot.segments;
  await batch([{ kind: 'edit', expected: changed, text: '查询之后的新文案' }, { kind: 'delete', expected: deleted }]);
  const result = await batch([
    { kind: 'edit', expected: changed, text: '过时覆盖' },
    { kind: 'edit', expected: deleted, text: '不应复活' },
    { kind: 'edit', expected: (await status()).snapshot.segments.find((s: { id: string }) => s.id === valid.id), text: '正常修改' },
  ]);
  assert.deepEqual(result.results.map((r: { outcome: string }) => r.outcome), ['changed', 'deleted', 'applied']);
  assert.equal(result.results[0].current.text, '查询之后的新文案');
  assert.deepEqual(result.summary, { applied: 1, changed: 1, deleted: 1, failed: 0 });
  assert.deepEqual((await status()).snapshot.segments.map((s: { text: string }) => s.text), ['查询之后的新文案', '正常修改']);
  assert.equal((await status()).modification, null);
});

test('用户连接断开释放修改权，旧取消凭据不能解除下一次编辑，异常保存也释放', async t => {
  const { beginEdit } = await import('../src/shared/client.js');
  const { service, post, status } = await fixture(t);
  const controller = new AbortController();
  const first = await fetch(`${service.url}/api/edit-session`, { method: 'POST', signal: controller.signal });
  const { token: oldToken } = JSON.parse(new TextDecoder().decode((await first.body!.getReader().read()).value).trim());
  controller.abort();
  for (let i = 0; i < 50 && (await status()).modification; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await status()).modification, null);
  const next = await beginEdit(service.url);
  await post('/api/edit-session/release', {}, oldToken);
  assert.deepEqual((await status()).modification, { owner: 'user' });
  assert.equal((await post('/api/segments/add', { text: '旧请求' }, oldToken)).status, 409);
  assert.equal((await post('/api/segments/edit', { id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', text: '不存在' }, next.token)).status, 500);
  assert.equal((await status()).modification, null);
  await next.close();
  const last = await beginEdit(service.url);
  assert.equal((await post('/api/segments/add', { text: '恢复正常' }, last.token)).status, 200);
  assert.equal((await status()).modification, null);
  await last.close();
});

test('Codex 存储异常逐项反馈失败，整批结束释放修改权且不提交失败内容', async t => {
  const { DatabaseSync } = await import('node:sqlite');
  const { post, status } = await fixture(t);
  const initial = await status();
  const db = new DatabaseSync(initial.snapshot.storage.database);
  try {
    db.exec('BEGIN IMMEDIATE');
    const response = await post('/api/codex/modify', { changes: [{ kind: 'add', text: '不会保存' }] });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.results[0].outcome, 'failed');
    assert.equal(result.summary.failed, 1);
    assert.equal(result.status.modification, null);
    assert.deepEqual(result.status.snapshot.segments, []);
  } finally { db.exec('ROLLBACK'); db.close(); }
  assert.equal((await post('/api/codex/modify', { changes: [{ kind: 'add', text: '恢复' }] })).status, 200);
});

test('同一项目不能由不同端口的两个服务同时修改，关闭所有者后可以重开', async t => {
  const { service, status } = await fixture(t);
  const initial = await status();
  const options = { projectDirectory: initial.snapshot.project.directory, panelDirectory: join(initial.snapshot.project.directory, '..', 'panel'), port: 0 };
  let unexpected: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    await assert.rejects(async () => { unexpected = await startService(options); }, /项目已由另一服务打开/);
  } finally { await unexpected?.close(); }
  assert.equal((await status()).modification, null);
  // fixture 的 close 应可重复调用；正常释放项目独占后允许重新打开。
  await service.close();
  const reopened = await startService(options);
  assert.equal((await (await fetch(`${reopened.url}/api/status`)).json()).snapshot.project.id, initial.snapshot.project.id);
  await reopened.close();
});

test('表格选择连接独立于修改权，断开后不能使用旧选择，表格可批量粘贴删除重排', async t => {
  const { service, post, status } = await fixture(t);
  const { beginEdit } = await import('../src/shared/client.js');
  const controller = new AbortController();
  const connected = await fetch(`${service.url}/api/table-session`, { method: 'POST', signal: controller.signal });
  assert.equal(connected.status, 200);
  const reader = connected.body!.getReader();
  const { tableId } = JSON.parse(new TextDecoder().decode((await reader.read()).value).trim());
  assert.equal((await status()).modification, null);
  const userBatch = async (changes: unknown[]) => {
    const lease = await beginEdit(service.url);
    try {
      const response = await post('/api/segments/modify', { changes }, lease.token);
      assert.equal(response.status, 200);
      return response.json();
    } finally { await lease.close(); }
  };
  await userBatch([{ kind: 'paste', text: '甲\n\n乙\n丙' }]);
  const [a, b, c] = (await status()).snapshot.segments;
  assert.equal((await post('/api/table-selection', { tableId, ids: [b.id] })).status, 200);
  const query = async (scope: unknown) => (await post('/api/segments/query', { scope })).json();
  assert.deepEqual((await query({ kind: 'selected' })).segments, [b]);
  await userBatch([{ kind: 'reorder', expectedIds: [a.id, b.id, c.id], ids: [c.id, a.id, b.id] }]);
  assert.deepEqual((await query({ kind: 'selected' })).segments.map((s: { id: string; order: number }) => [s.id, s.order]), [[b.id, 3]]);
  controller.abort();
  for (let i = 0; i < 50 && (await query({ kind: 'selected' })).availability !== 'unavailable'; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await query({ kind: 'selected' })).availability, 'unavailable');
  assert.equal((await post('/api/codex/process', { scope: { kind: 'selected' }, expected: [b], action: { kind: 'delete' } })).status, 409);
  const explicit = await query({ kind: 'ids', ids: [b.id] });
  assert.equal((await post('/api/codex/process', { scope: { kind: 'ids', ids: [b.id] }, expected: explicit.segments, action: { kind: 'delete' } })).status, 200);
  assert.deepEqual((await status()).snapshot.segments.map((s: { text: string }) => s.text), ['丙', '甲']);
});
