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
  const { binding } = await (await fetch(`${origin}/api/binding`, { method: 'POST', body: JSON.stringify({ threadId, workspace: identity.workspace, projectId: identity.projectId, instanceId: identity.instanceId }) })).json();
  const url = `${origin}/binding/${binding}`;
  const tables = await Promise.all([connectTable(url), connectTable(url), connectTable(url)]);
  const editing = await beginEdit(url);
  const before = spawned();
  await new Promise(resolve => setTimeout(resolve, 3500));
  assert.ok(spawned() - before <= 1, `四条长连接心跳 3.5 秒内只应共享至多一次宿主核对，实际 ${spawned() - before} 次`);
  setWorkspace(second);
  await Promise.race([Promise.all([editing.closed, ...tables.map(table => table.closed)]),
    new Promise((_, reject) => setTimeout(() => reject(new Error('工作空间改变后长连接未释放')), 8000))]);
});
