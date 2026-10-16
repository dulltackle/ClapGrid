import { mkdirSync, mkdtempSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { git, sourceIdentity, sameSource } from './check-source.mjs';
import { runLogged } from './check-runner.mjs';
import { atomicJson, processIdentity, startVerification, verificationStatus, waitVerification } from './verification-jobs.mjs';

/** 独立 Git 检出不共享工作区或 node_modules；日志和失败现场保留供复核。 */
export async function executeVerification(root, revision, outputRoot = join(root, 'logs/verify'), job) {
  if (!revision) throw Error('正式验收必须指定 --revision <提交>');
  const commit = git(root, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]);
  mkdirSync(outputRoot, { recursive: true });
  const directory = job?.directory ?? mkdtempSync(join(outputRoot, 'run-'));
  const checkout = join(directory, 'source');
  const summary = { ...job, mode: 'verification', commit, checkout, directory, startedAt: job?.startedAt ?? new Date().toISOString(), owner: processIdentity(), node: process.version, status: 'running', results: [] };
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
  console.log(`正式验收日志：${directory}`); save();
  try {
    summary.phase = 'checkout'; save();
    git(root, ['clone', '--quiet', '--no-checkout', '--no-hardlinks', '--', root, checkout]);
    git(checkout, ['checkout', '--quiet', '--detach', commit]);
    for (const entry of git(checkout, ['ls-files', '--stage', '-z']).split('\0').filter(Boolean)) {
      if (entry.startsWith('120000 ') || entry.startsWith('160000 ')) throw Error('正式验收暂不支持源码符号链接或子模块');
    }
    summary.source = sourceIdentity(checkout);
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    summary.phase = 'install'; save();
    const install = await runLogged(npm, ['ci'], checkout, join(directory, 'install.log'));
    summary.results.push({ name: 'install', ...install }); save();
    if (install.status !== 'passed') throw Error('锁定依赖安装失败');
    if (!sameSource(summary.source, sourceIdentity(checkout))) throw Error('依赖安装改变了受验源码');
    summary.phase = 'check'; save();
    const result = await runLogged(npm, ['run', 'check'], checkout, join(directory, 'check.log'));
    summary.results.push({ name: 'check', ...result });
    const checks = join(checkout, 'logs/check');
    const runs = readdirSync(checks).filter(name => lstatSync(join(checks, name)).isDirectory());
    if (runs.length !== 1) throw Error('正式验收需要唯一一份项目检查记录');
    summary.checkSummary = join(checks, runs[0], 'summary.json');
    const check = JSON.parse(readFileSync(summary.checkSummary, 'utf8'));
    summary.checkResults = check.results;
    summary.failures = check.results?.filter(step => step.status !== 'passed');
    summary.sourceAfter = sourceIdentity(checkout);
    if (!sameSource(summary.source, summary.sourceAfter) || summary.sourceAfter.dirty || !check.source || !check.sourceAfter || !sameSource(summary.source, check.source) || !sameSource(summary.source, check.sourceAfter)) throw Error('受验源码或项目检查证据发生变化');
    if (result.status !== 'passed' || check.status !== 'passed' || check.pending?.length !== 0 || !Array.isArray(check.results) || check.results.length !== 3 || !['typecheck', 'test', 'build'].every(name => check.results.some(step => step.name === name && step.status === 'passed' && step.exitCode === 0))) throw Error('项目检查未全部通过');
    summary.status = 'passed';
  } catch (error) { summary.status = 'failed'; summary.error = String(error); }
  finally { clearInterval(heartbeat); }
  summary.phase = 'completed';
  summary.completedAt = new Date().toISOString(); save();
  return summary;
}

/** 兼容原接口；观察者结束不会向独立后台任务发送信号。 */
export async function verify(root, revision, outputRoot = join(root, 'logs/verify'), options = {}) {
  const job = await startVerification(root, revision, outputRoot, options);
  console.log(`正式验收 ${job.reused ? '复用历史记录' : job.attached ? '连接已有任务' : '已启动'}：${job.runId}\n日志：${job.directory}`);
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
      if (action === 'cancel') throw Error('自动取消尚不能跨平台确认完整子进程树；未发送终止信号。请保留任务并查询 status，避免误杀其他进程。');
    } else if (action === 'start') result = await startVerification(root, values.revision, undefined, { reusePassed: values['reuse-passed'] });
    else if (values.run) result = await waitVerification(join(root, 'logs/verify', values.run));
    else result = await verify(root, values.revision, undefined, { reusePassed: values['reuse-passed'] });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = action === 'start' || action === 'status' ? 0 : result.status === 'passed' ? 0 : 1;
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
