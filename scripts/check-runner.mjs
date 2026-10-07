import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sameSource, sourceIdentity } from './check-source.mjs';

export async function runLogged(command, args, cwd, logPath) {
  const log = createWriteStream(logPath);
  return new Promise(resolveResult => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let errorMessage;
    child.stdout.on('data', chunk => { process.stdout.write(chunk); log.write(chunk); });
    child.stderr.on('data', chunk => { process.stderr.write(chunk); log.write(chunk); });
    child.on('error', error => { errorMessage = error.message; log.write(`${error.message}\n`); });
    child.on('close', (exitCode, signal) => log.end(() => resolveResult({ status: exitCode === 0 && !errorMessage ? 'passed' : 'failed', exitCode, signal, error: errorMessage })));
  });
}

export async function runCheck(root, directory = resolve(root, 'logs/check', new Date().toISOString().replaceAll(':', '-') + `-${process.pid}`)) {
  mkdirSync(directory, { recursive: true });
  console.log(`检查日志：${directory}`);
  const names = ['typecheck', 'test', 'build'];
  const summary = { mode: 'development', startedAt: new Date().toISOString(), node: process.version, source: sourceIdentity(root), status: 'running', results: [], pending: [...names], note: '开发检查允许未提交内容；阶段指纹只用于发现变化，不证明期间从未修改。跳过不代表通过，详见 test.log。' };
  const save = () => writeFileSync(resolve(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  save();
  try {
    for (const name of names) {
      console.log(`开始 ${name}`);
      const result = await runLogged(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', name], root, resolve(directory, `${name}.log`));
      summary.results.push({ name, ...result });
      summary.pending = names.filter(step => !summary.results.some(result => result.name === step));
      summary.sourceAfter = sourceIdentity(root);
      if (!sameSource(summary.source, summary.sourceAfter)) {
        summary.status = 'invalidated'; summary.completedAt = new Date().toISOString(); save(); return summary;
      }
      save();
    }
    summary.status = summary.results.every(result => result.status === 'passed') ? 'passed' : 'failed';
  } catch (error) { summary.status = 'failed'; summary.error = String(error); }
  summary.completedAt = new Date().toISOString(); save();
  return summary;
}
