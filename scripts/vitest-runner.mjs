import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executionPlan, executionIdentityAsync, executorEvidenceAsync } from './test-evidence.mjs';
import { parseArgs } from 'node:util';
import { nodeCompileCacheEnvironment } from './node-compile-cache.mjs';

export async function runVitest(root, plan, report, identity, options = {}) {
  return (await executeVitest(root, plan, report, identity, { signal: options.signal })).code;
}

/** 身份始终由本适配器实际采集；调用者不能注入已有源码快照。 */
export async function runVitestFresh(root, plan, report, executionId, options = {}) {
  // 用户的 Node 预载可能执行项目代码；未知选项保守沿用先校验、后启动。
  if (process.env.NODE_OPTIONS?.trim()) return executeVitest(root, plan, report, await executionIdentityAsync(root, executionId, { signal: options.signal }), { signal: options.signal });
  return executeVitest(root, plan, report, { executionId }, { signal: options.signal, fresh: true });
}

async function executeVitest(root, plan, report, identity, { signal: abortSignal, fresh = false } = {}) {
  const nativePath = report.replace(/\.json$/, '') + '-native.json';
  const logPath = report + '.log';
  const log = createWriteStream(logPath);
  const require = createRequire(resolve(root, 'package.json'));
  const bin = fileURLToPath(new URL('./vitest.mjs', new URL(require.resolve('vitest/package.json'), 'file:')));
  const env = nodeCompileCacheEnvironment(root, { ...process.env, CLAPGRID_TEST_EXECUTION_ID: identity.executionId, CLAPGRID_VITEST_NATIVE_REPORT: nativePath }); delete env.NODE_TEST_CONTEXT;
  const args = fresh ? [resolve(root, 'scripts/vitest-bootstrap.mjs'), ...plan.files]
    : [bin, 'run', '--includeTaskLocation', '--pool=forks', '--isolate', '--allowOnly=false', '--retry=0', '--maxWorkers=1', '--no-file-parallelism', '--config', 'vitest.config.ts', '--reporter=default', `--reporter=${resolve(root, 'scripts/vitest-reporter.mjs')}`, ...plan.files];
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: fresh ? ['ignore', 'pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'], detached: false });
  const ignore = () => {}; process.on('SIGINT', ignore); process.on('SIGTERM', ignore);
  const capture = (target, chunk) => { target.write(chunk); log.write(chunk); };
  child.stdout.on('data', chunk => capture(process.stdout, chunk)); child.stderr.on('data', chunk => capture(process.stderr, chunk));
  let failure;
  child.on('error', error => { failure = error; });
  const done = new Promise(resolveExit => child.on('close', (code, signal) => resolveExit({ code, signal })));
  const captureController = new AbortController();
  let captured;
  let killTimer;
  const abort = () => {
    captureController.abort(abortSignal?.reason ?? Error('框架启动已中止'));
    if (child.exitCode === null) child.kill('SIGTERM');
    killTimer ??= setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 1000);
  };
  abortSignal?.addEventListener('abort', abort, { once: true });
  try {
    if (fresh) {
      let buffer = '';
      const pipe = child.stdio[3];
      const ready = new Promise((yes, no) => {
        pipe.on('error', no);
        pipe.on('data', chunk => {
          buffer += chunk;
          if (buffer.length > 4096) return no(Error('框架预加载消息超长'));
          const newline = buffer.indexOf('\n');
          if (newline < 0) return;
          try {
            const message = JSON.parse(buffer.slice(0, newline));
            if (message.kind !== 'ready' || message.nonce !== identity.executionId || buffer.slice(newline + 1)) throw Error('框架预加载身份不符');
            yes();
          } catch (error) { no(error); }
        });
        done.then(() => no(failure ?? Error('框架预加载未完成就已退出')));
      });
      // 两条实际任务都立即挂上拒绝处理，失败时统一等待子进程退出。
      captured = executionIdentityAsync(root, identity.executionId, { signal: AbortSignal.any([captureController.signal, ...(abortSignal ? [abortSignal] : [])]) });
      const result = await Promise.all([captured, ready]);
      identity = result[0];
      abortSignal?.throwIfAborted();
      pipe.write(JSON.stringify({ kind: 'release', nonce: identity.executionId }) + '\n');
    }
  } catch (error) {
    failure ??= error;
    abort();
    await done;
    await captured?.catch(() => {});
  }
  const { code, signal } = await done;
  clearTimeout(killTimer);
  abortSignal?.removeEventListener('abort', abort);
  await new Promise(resolveLog => log.end(resolveLog));
  process.off('SIGINT', ignore); process.off('SIGTERM', ignore);
  if (fresh && failure) { console.error(failure.message); return { code: abortSignal?.aborted ? 130 : code || 1, identity }; }
  try {
    const evidence = await executorEvidenceAsync(root, plan, nativePath, identity, { logPath, signal: abortSignal });
    writeFileSync(report, JSON.stringify(evidence, null, 2) + '\n');
    if (evidence.status !== 'passed') console.error(evidence.validationError);
    return { code: code === 0 && !failure && evidence.status === 'passed' ? 0 : code || (signal ? 130 : 1), identity };
  } catch (error) { console.error(`Vitest 报告缺失或无效：${error.message}`); return { code: code || (signal ? 130 : 1), identity }; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { files: { type: 'string' }, suite: { type: 'string', default: 'all' } } });
    const root = resolve(import.meta.dirname, '..');
    const plan = executionPlan(root, { suite: values.suite, files: values.files ? JSON.parse(values.files) : undefined, executor: 'vitest' });
    const report = resolve(process.env.CLAPGRID_TEST_REPORT ?? `logs/tests/${Date.now()}-${process.pid}.json`); mkdirSync(dirname(report), { recursive: true });
    process.exitCode = await runVitest(root, plan, report, await executionIdentityAsync(root, process.env.CLAPGRID_TEST_EXECUTION_ID ?? randomUUID()));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
