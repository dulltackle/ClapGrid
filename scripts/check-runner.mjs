import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { sameSource, sourceIdentity } from './check-source.mjs';
import { atomicJson } from './verification-jobs.mjs';

export async function runLogged(command, args, cwd, logPath) {
  const log = createWriteStream(logPath);
  return new Promise(resolveResult => {
    // node:test 的父子通信标记属于当前测试进程，继承给独立检查会使嵌套 --test 被当作测试子进程。
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let errorMessage;
    let tail = '';
    let lineRemainder = '';
    const diagnostics = [];
    const capture = chunk => {
      tail = (tail + chunk.toString()).slice(-8000); log.write(chunk);
      const lines = (lineRemainder + chunk.toString()).split('\n');
      lineRemainder = lines.pop();
      for (const line of lines) if (/not ok |error TS\d|^✖|^FAIL|Error:/.test(line)) { diagnostics.push(line.slice(0, 500)); if (diagnostics.length > 12) diagnostics.shift(); }
    };
    child.stdout.on('data', chunk => { process.stdout.write(chunk); capture(chunk); });
    child.stderr.on('data', chunk => { process.stderr.write(chunk); capture(chunk); });
    child.on('error', error => { errorMessage = error.message; log.write(`${error.message}\n`); });
    child.on('close', (exitCode, signal) => log.end(() => resolveResult({ status: exitCode === 0 && !errorMessage ? 'passed' : 'failed', exitCode, signal, error: errorMessage,
      ...(exitCode !== 0 || errorMessage ? { failureSummary: [...diagnostics, ...tail.trim().split('\n').slice(-6)].join('\n').slice(-4000) } : {}) })));
  });
}

export async function runCheck(root, directory = resolve(root, 'logs/check', new Date().toISOString().replaceAll(':', '-') + `-${process.pid}`)) {
  mkdirSync(directory, { recursive: true });
  console.log(`检查日志：${directory}`);
  const names = ['typecheck', 'test', 'build'];
  const summary = { mode: 'development', startedAt: new Date().toISOString(), node: process.version, source: sourceIdentity(root), status: 'running', results: [], pending: [...names], note: '开发检查允许未提交内容；阶段指纹只用于发现变化，不证明期间从未修改。跳过不代表通过，详见 test.log。' };
  const save = () => { summary.heartbeatAt = new Date().toISOString(); atomicJson(resolve(directory, 'summary.json'), summary); };
  save();
  try {
    for (const name of names) {
      summary.phase = name; save();
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
