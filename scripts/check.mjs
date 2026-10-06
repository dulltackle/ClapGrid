import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const startedAt = new Date().toISOString();
const directory = resolve(root, 'logs/check', startedAt.replaceAll(':', '-') + `-${process.pid}`);
mkdirSync(directory, { recursive: true });
console.log(`检查日志：${directory}`);
const results = [];
for (const name of ['typecheck', 'test', 'build']) {
  console.log(`\n开始 ${name}`);
  const log = createWriteStream(resolve(directory, `${name}.log`));
  const result = await new Promise(resolveResult => {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', name], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => { process.stdout.write(chunk); log.write(chunk); });
    child.stderr.on('data', chunk => { process.stderr.write(chunk); log.write(chunk); });
    child.on('error', error => { log.write(`${error.message}\n`); });
    child.on('close', (code, signal) => log.end(() => resolveResult({
      name, status: code === 0 ? 'passed' : 'failed', exitCode: code, signal,
    })));
  });
  results.push(result);
  writeFileSync(resolve(directory, 'summary.json'), JSON.stringify({
    startedAt, node: process.version, results,
    pending: ['typecheck', 'test', 'build'].filter(step => !results.some(result => result.name === step)),
    note: '测试计数、失败与跳过原因以 test.log 原始报告为准；跳过不代表通过。',
  }, null, 2) + '\n');
  console.log(`${name}: ${result.status} (exit=${result.exitCode}, signal=${result.signal ?? 'none'})`);
}
console.log(`\n完整日志与结果：${directory}`);
process.exitCode = results.some(result => result.status !== 'passed') ? 1 : 0;
