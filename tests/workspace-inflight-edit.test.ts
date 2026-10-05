import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { startService } from '../src/service/server.js';
import { beginEdit, queryStatus } from '../src/shared/client.js';

for (const owner of ['codex', 'user'] as const) for (const operation of ['import', 'video', 'settings', 'unobserved'] as const) test(`${owner} 在途 ${operation} 撤销后不提交，媒体清理完才释放修改权`, { timeout: 30000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-inflight-'));
  const workspace = join(root, 'workspace'); const dist = join(root, 'dist');
  mkdirSync(workspace); mkdirSync(join(dist, 'panel'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(dist, 'panel', 'index.html'), 'test');
  const threadId = randomUUID(); const state = join(root, 'host.json'); const host = join(root, 'host.cjs');
  const setWorkspace = (cwd: string | null) => writeFileSync(state, JSON.stringify({ id: threadId, cwd })); setWorkspace(workspace);
  writeFileSync(host, `#!/usr/bin/env node\nconst fs=require('node:fs');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.method==='initialize')console.log(JSON.stringify({id:r.id,result:{}}));if(r.method==='thread/read')console.log(JSON.stringify({id:r.id,result:{thread:JSON.parse(fs.readFileSync(${JSON.stringify(state)},'utf8'))}}));});`, { mode: 0o700 });
  const oldHost = process.env.CLAPGRID_CODEX_BIN; const oldPath = process.env.PATH;
  process.env.CLAPGRID_CODEX_BIN = host;
  const source = join(root, 'source.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=96x96:d=1', '-c:v', 'libx264', source]);
  const bin = join(root, 'bin'); mkdirSync(bin); const marker = join(root, 'started'); const gate = join(root, 'continue');
  writeFileSync(join(bin, 'ffmpeg'), `#!/bin/sh\ntrap '' TERM\ntouch '${marker}'\nwhile [ ! -f '${gate}' ]; do sleep 0.05; done\nexec /usr/bin/ffmpeg "$@"\n`, { mode: 0o700 });
  process.env.PATH = bin + ':' + oldPath;
  const service = await startService({ workspaceDirectory: workspace, projectDirectory: join(workspace, 'clapgrid'), panelDirectory: join(dist, 'panel'), port: 0 });
  t.after(async () => { writeFileSync(gate, 'continue'); await service.close(); if (oldHost === undefined) delete process.env.CLAPGRID_CODEX_BIN; else process.env.CLAPGRID_CODEX_BIN = oldHost; process.env.PATH = oldPath; rmSync(root, { recursive: true, force: true }); });
  await build({ entryPoints: ['src/runtime.ts'], outdir: dist, bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['vite'], banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
  const open = async () => JSON.parse((await promisify(execFile)(process.execPath, [join(dist, 'runtime.js'), 'open', '--workspace', workspace, '--thread', threadId], { env: process.env })).stdout);
  const opened = await open();
  const post = (path: string, body: unknown, token?: string) => fetch(opened.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Edit-Token': token } : {}) }, body: JSON.stringify(body) });
  let assetId: string | undefined;
  if (operation === 'video') {
    writeFileSync(gate, 'continue');
    const imported = await post('/api/codex/import-video', { sourcePath: source });
    assert.equal(imported.ok, true); assetId = (await imported.json()).asset.id;
    await post('/api/codex/modify', { changes: [{ kind: 'add', text: '保持原画面关联' }] });
    rmSync(gate); rmSync(marker);
  }
  const before = await queryStatus(opened.url);
  const filesBefore = readdirSync(join(workspace, 'clapgrid', 'media')).sort();
  const edit = owner === 'user' ? await beginEdit(opened.url) : undefined;
  const path = operation === 'video' ? (owner === 'codex' ? '/api/codex/modify' : '/api/segments/modify')
    : operation === 'settings' ? (owner === 'codex' ? '/api/codex/export-settings' : '/api/export-settings')
    : owner === 'codex' ? '/api/codex/import-video' : '/api/video/import';
  const body = operation === 'video' ? { changes: [{ kind: 'video', expected: before.snapshot.segments[0], assetId, start: 0 }] }
    : operation === 'settings' ? { expected: before.snapshot.exportSettings, settings: { ...before.snapshot.exportSettings, fps: 60 } } : { sourcePath: source };
  const pending = post(path, body, edit?.token);
  for (let i = 0; !existsSync(marker) && i < 300; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(existsSync(marker), true);
  setWorkspace(null);
  if (operation !== 'unobserved') {
    await assert.rejects(queryStatus(opened.url), /关闭重开/); setWorkspace(workspace);
    const fresh = await open();
    assert.deepEqual((await queryStatus(fresh.url)).modification, { owner }, '媒体子进程尚未结束时保持占用');
    await assert.rejects(beginEdit(fresh.url), /修改|编辑/);
  }
  writeFileSync(gate, 'continue');
  const response = await pending;
  const result = await response.json();
  assert.equal(response.ok && (operation !== 'video' || result.summary.applied > 0), false, '失效旧请求不能提交');
  setWorkspace(workspace); const fresh = await open(); const after = await queryStatus(fresh.url);
  assert.deepEqual(after.snapshot, before.snapshot, '撤销不改变素材、画面关联或导出设置');
  assert.equal(after.modification, null);
  assert.deepEqual(readdirSync(join(workspace, 'clapgrid', 'media')).sort(), filesBefore, '本次临时媒体清理后才解锁，已提交素材保持');

});
