import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { startService } from '../src/service/server.js';
import { beginEdit, connectTable } from '../src/shared/client.js';

test('心跳共享宿主工作空间核对：多条长连接不再每秒启动宿主进程，工作空间改变后仍会释放', { timeout: 30000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-heartbeat-'));
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'test');
  const first = join(root, 'first'); const second = join(root, 'second'); mkdirSync(first); mkdirSync(second);
  const threadId = randomUUID(); const state = join(root, 'host.json'); const spawns = join(root, 'spawns'); const host = join(root, 'host.cjs');
  const setWorkspace = (cwd: string) => writeFileSync(state, JSON.stringify({ id: threadId, cwd }));
  const spawned = () => existsSync(spawns) ? readFileSync(spawns, 'utf8').length : 0;
  setWorkspace(first);
  writeFileSync(host, `#!/usr/bin/env node\nconst fs=require('node:fs');fs.appendFileSync(${JSON.stringify(spawns)},'.');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.method==='initialize')console.log(JSON.stringify({id:r.id,result:{}}));if(r.method==='thread/read')console.log(JSON.stringify({id:r.id,result:{thread:JSON.parse(fs.readFileSync(${JSON.stringify(state)},'utf8'))}}));});`, { mode: 0o700 });
  const previousHost = process.env.CLAPGRID_CODEX_BIN; process.env.CLAPGRID_CODEX_BIN = host;
  const service = await startService({ projectDirectory: join(first, 'clapgrid'), workspaceDirectory: first, panelDirectory, port: 0 });
  t.after(async () => { await service.close(); if (previousHost === undefined) delete process.env.CLAPGRID_CODEX_BIN; else process.env.CLAPGRID_CODEX_BIN = previousHost; rmSync(root, { recursive: true, force: true }); });
  const origin = service.url;
  const identity = await (await fetch(`${origin}/api/identity`)).json();
  const bind = async () => (await (await fetch(`${origin}/api/binding`, { method: 'POST', body: JSON.stringify({ threadId, workspace: identity.workspace, projectId: identity.projectId, instanceId: identity.instanceId }) })).json()).binding;
  const binding = await bind();
  const url = `${origin}/binding/${binding}`;
  const tables = await Promise.all([connectTable(url), connectTable(url), connectTable(url)]);
  const editing = await beginEdit(url);
  const before = spawned();
  await new Promise(resolve => setTimeout(resolve, 3500));
  assert.ok(spawned() - before <= 1, `四条长连接心跳 3.5 秒内只应共享至多一次宿主核对，实际 ${spawned() - before} 次`);
  setWorkspace(second);
  await Promise.race([Promise.all([editing.closed, ...tables.map(table => table.closed)]),
    new Promise((_, reject) => setTimeout(() => reject(new Error('工作空间改变后长连接未释放')), 8000))]);
  setWorkspace(first);
  const freshUrl = `${origin}/binding/${await bind()}`;
  assert.notEqual(freshUrl, url);
  const fresh = await connectTable(freshUrl);
  const outcome = await Promise.race([fresh.closed.then(() => 'closed'), new Promise(resolve => setTimeout(() => resolve('open'), 1700))]);
  assert.equal(outcome, 'open', '重新核对成功的新代次不得被上一代次缓存工作空间撤销');
  assert.equal((await fetch(`${freshUrl}/api/status`)).status, 200);
  assert.equal(`${origin}/binding/${await bind()}`, freshUrl, '同代次重复绑定不轮换身份');
  const extra = await connectTable(freshUrl);
  const cachedBefore = spawned();
  await new Promise(resolve => setTimeout(resolve, 1700));
  assert.equal(spawned(), cachedBefore, '合法新代次的多条连接继续共享心跳缓存');
  setWorkspace(second);
  const rejected = await fetch(`${freshUrl}/api/codex/modify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes: [{ kind: 'add', text: '不得采用心跳缓存写入' }] }) });
  assert.equal(rejected.status, 409, '业务写入实时核对，不能采用刚缓存的原工作空间');
  await Promise.all([fresh.closed, extra.closed]);
  setWorkspace(first);
  const verified = `${origin}/binding/${await bind()}`;
  assert.equal((await (await fetch(`${verified}/api/status`)).json()).snapshot.segments.length, 0);


});
