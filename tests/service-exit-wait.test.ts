import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serviceProcess, waitForServiceExit } from './helpers/service-exit.js';

test('端口先关闭而服务仍在写清理记录时，等待真实退出后才允许删除目录', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-service-exit-'));
  const marker = join(root, 'cleanup-finished');
  const script = `const{createServer}=require('node:http');const{writeFileSync}=require('node:fs');
    const server=createServer((request,response)=>{response.end('stopping');server.close(()=>setTimeout(()=>writeFileSync(${JSON.stringify(marker)},'finished'),350));});
    server.listen(0,'127.0.0.1',()=>console.log(server.address().port));`;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => { if (child.exitCode === null) child.kill('SIGTERM'); await exited; rmSync(root, { recursive: true, force: true }); });
  const port = await new Promise<string>((resolve, reject) => {
    let output = ''; child.stdout.on('data', chunk => { output += chunk; if (output.includes('\n')) resolve(output.trim()); }); child.once('error', reject);
  });
  const identity = serviceProcess(child.pid!);
  await (await fetch(`http://127.0.0.1:${port}/stop`)).text();
  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/identity`), '旧端口等待条件已满足');
  await waitForServiceExit(identity);
  assert.equal(readFileSync(marker, 'utf8'), 'finished', '不能在进程的迟到清理完成前删除目录');
});

test('服务未退出时超时失败，不强行结束进程或允许清理', async t => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => { child.kill('SIGTERM'); await exited; });
  const identity = serviceProcess(child.pid!);
  await assert.rejects(waitForServiceExit(identity, { timeoutMs: 60, intervalMs: 10 }), /尚未确认退出/);
  assert.equal(child.exitCode, null, '等待器只观察，不终止服务');
});
