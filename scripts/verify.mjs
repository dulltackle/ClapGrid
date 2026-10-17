import { mkdirSync, mkdtempSync, readFileSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { git, sourceIdentity, sameSource } from './check-source.mjs';
import { runLogged, checkProgress } from './check-runner.mjs';
import { withCheckRun, releaseCheckReservation } from './check-lifecycle.mjs';
import { atomicJson, processIdentity, startVerification, verificationStatus, waitVerification, cancelVerification } from './verification-jobs.mjs';

/** 独立 Git 检出不共享工作区或 node_modules；日志和失败现场保留供复核。 */
export async function executeVerification(root, revision, outputRoot = join(root, 'logs/verify'), job) {
  if (!revision) throw Error('正式验收必须指定 --revision <提交>');
  const commit = git(root, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]);
  mkdirSync(outputRoot, { recursive: true });
  const directory = job?.directory ?? mkdtempSync(join(outputRoot, 'run-'));
  const checkout = join(directory, 'source');
  const summary = { ...job, mode: 'verification', commit, checkout, directory, startedAt: job?.startedAt ?? new Date().toISOString(), owner: processIdentity(), executionReady: false, node: process.version, status: 'running', results: [] };
  const save = () => { summary.heartbeatAt = new Date().toISOString(); atomicJson(join(directory, 'summary.json'), summary); };
  const heartbeat = setInterval(() => {
    if (summary.phase === 'check') {
      try {
        const checks = join(checkout, 'logs/check');
        const runs = readdirSync(checks);
        if (runs.length === 1) {
          const check = JSON.parse(readFileSync(join(checks, runs[0], 'summary.json'), 'utf8'));
          summary.checkPhase = check.phase ?? check.pending?.[0];
          summary.checkResults = check.results;
        }
      } catch { /* 子检查尚未发布记录，保留当前阶段。 */ }
    }
    save();
  }, 5000);
  checkProgress(`正式验收日志：${directory}`); save();
  try {
    await withCheckRun(root, 'verification', async context => {
      summary.owner = processIdentity();
      summary.executionReady = true; save();
      context.recordLog(directory);
      const cancelled = () => { if (context.signal.aborted) throw Object.assign(Error('正式验收已取消'), { cancelled: true }); };
      cancelled();
      summary.phase = 'checkout'; save();
      git(root, ['clone', '--quiet', '--no-checkout', '--no-hardlinks', '--', root, checkout]);
      git(checkout, ['checkout', '--quiet', '--detach', commit]);
      for (const entry of git(checkout, ['ls-files', '--stage', '-z']).split('\0').filter(Boolean)) {
        if (entry.startsWith('120000 ') || entry.startsWith('160000 ')) throw Error('正式验收暂不支持源码符号链接或子模块');
      }
      summary.source = sourceIdentity(checkout);
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      summary.phase = 'install'; save();
      const install = await runLogged(npm, ['ci'], checkout, join(directory, 'install.log'), context);
      summary.results.push({ name: 'install', ...install }); save();
      cancelled();
      if (install.status !== 'passed') throw Error('锁定依赖安装失败');
      if (!sameSource(summary.source, sourceIdentity(checkout))) throw Error('依赖安装改变了受验源码');
      summary.phase = 'check'; save();
      const result = await runLogged(npm, ['run', 'check'], checkout, join(directory, 'check.log'), context, { CLAPGRID_CHECK_CHILD_ROOT: checkout });
      summary.results.push({ name: 'check', ...result });
      cancelled();
      const checks = join(checkout, 'logs/check');
      const runs = readdirSync(checks).filter(name => lstatSync(join(checks, name)).isDirectory());
      if (runs.length !== 1) throw Error('正式验收需要唯一一份项目检查记录');
      summary.checkSummary = join(checks, runs[0], 'summary.json');
      const check = JSON.parse(readFileSync(summary.checkSummary, 'utf8'));
      summary.checkResults = check.results;
      summary.failures = check.failures;
      summary.failedStages = check.results?.filter(step => step.status !== 'passed');
      summary.preflight = check.preflight;
      summary.sourceAfter = sourceIdentity(checkout);
      if (!sameSource(summary.source, summary.sourceAfter) || summary.sourceAfter.dirty || !check.source || !check.sourceAfter || !sameSource(summary.source, check.source) || !sameSource(summary.source, check.sourceAfter)) throw Error('受验源码或项目检查证据发生变化');
      if (!check.preflight || check.preflight.status !== 'passed' || !sameSource(summary.source, check.preflight.source) || !sameSource(summary.source, check.preflight.sourceAfter)) throw Error('固定提交的强制预检未通过或证据不匹配');
      if (result.status !== 'passed' || check.status !== 'passed' || check.pending?.length !== 0 || !Array.isArray(check.results) || check.results.length !== 3 || !['typecheck', 'test', 'build'].every(name => check.results.some(step => step.name === name && step.status === 'passed' && step.exitCode === 0))) throw Error('项目检查未全部通过');
      if (existsSync(join(checkout, 'scripts/test-inventory.json'))) {
        const { validateCheckEvidence } = await import('./test-evidence.mjs');
        validateCheckEvidence(checkout, check, summary.source);
      }
      summary.phase = 'cleanup'; save();
    }, { reservation: job?.token, metadata: job ? { verificationKey: job.key, verificationDirectory: directory } : {} });
    summary.status = 'passed';
  } catch (error) {
    if (!summary.executionReady && job) releaseCheckReservation(root, job.token);
    summary.status = error.cancelled ? 'cancelled' : 'failed'; summary.error = String(error);
  }
  finally { clearInterval(heartbeat); }
  summary.phase = 'completed';
  summary.completedAt = new Date().toISOString(); save();
  return summary;
}

/** 兼容原接口；观察者结束不会向独立后台任务发送信号。 */
export async function verify(root, revision, outputRoot = join(root, 'logs/verify'), options = {}) {
  const job = await startVerification(root, revision, outputRoot, options);
  checkProgress(`正式验收 ${job.reused ? '复用历史记录' : job.attached ? '连接已有任务' : '已启动'}：${job.runId}\n日志：${job.directory}`);
  if (job.reused) return job;
  return waitVerification(job.directory, options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: { revision: { type: 'string' }, run: { type: 'string' }, 'reuse-passed': { type: 'boolean', default: false } } });
    const root = fileURLToPath(new URL('../', import.meta.url));
    const action = positionals[0] ?? 'wait';
    if (positionals.length > 1 || !['wait', 'start', 'status', 'cancel'].includes(action)) throw Error('用法：verify [start|status|cancel] --revision <提交> | --run <runId>');
    if (values.run && !/^run-[\w-]+$/.test(values.run)) throw Error('查询任务需要有效 --run <runId>');
    let result;
    if (action === 'status' || action === 'cancel') {
      if (!values.run || !/^run-[\w-]+$/.test(values.run)) throw Error('查询任务需要 --run <runId>');
      result = verificationStatus(join(root, 'logs/verify', values.run));
      if (action === 'cancel') result = await cancelVerification(root, join(root, 'logs/verify', values.run));
    } else if (action === 'start') result = await startVerification(root, values.revision, undefined, { reusePassed: values['reuse-passed'] });
    else if (values.run) result = await waitVerification(join(root, 'logs/verify', values.run));
    else result = await verify(root, values.revision, undefined, { reusePassed: values['reuse-passed'] });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = action === 'status' || action === 'start' && result.status === 'running' || result.status === 'passed' ? 0 : result.status === 'cancelled' ? 130 : 1;
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
