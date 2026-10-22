import { test } from './helpers/resource-test.js';
import { expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { ownerAlive } = await import(new URL('./helpers/product-process.mjs', import.meta.url).href);

test('取消启动 CLI 时，拒绝正常终止的已拥有后代也确认退出', async ({ command, onTestFinished, signal }) => {
    const t = { onTestFinished, signal };
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-command-exit-'));
  const marker = join(root, 'owner.json');
  const script = join(root, 'refuse.cjs');
  writeFileSync(script, `const fs=require('node:fs');import(${JSON.stringify(new URL('./helpers/product-process.mjs', import.meta.url).href)}).then(({processIdentity})=>{process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify(processIdentity()));setInterval(()=>{},1000);});`);
  const abort = new AbortController();
  const run = command(process.execPath, ['-e', `const {spawn}=require('node:child_process');const c=spawn(process.execPath,[${JSON.stringify(script)}],{stdio:'inherit'});setTimeout(()=>process.exit(0),200);`], { signal: abort.signal, timeout: 2000 });
  void run.catch(() => {});
  let owner: any;
  t.onTestFinished(async () => {
    await run.stop();
    if (owner && ownerAlive(owner) === false) rmSync(root, { recursive: true, force: true });
    else throw Error(`测试子进程尚未退出，保留 ${root}`);
  });
  await expect.poll(() => { try { owner = JSON.parse(readFileSync(marker, 'utf8')); return true; } catch { return false; } }).toBe(true);
  await new Promise(resolve => setTimeout(resolve, 250));
  abort.abort(Error('用户取消'));
  await expect(run).rejects.toThrow(/已取消/);
  expect(ownerAlive(owner)).toBe(false);
});
