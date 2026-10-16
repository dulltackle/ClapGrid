import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));
const runnerUrl = new URL('../scripts/check-runner.mjs', import.meta.url).href;
const verifyUrl = new URL('../scripts/verify.mjs', import.meta.url).href;
const identityUrl = new URL('../scripts/check-source.mjs', import.meta.url).href;
const { runCheck, runLogged } = await import(runnerUrl);
const { verify } = await import(verifyUrl);
const { sourceIdentity } = await import(identityUrl);
const jobsUrl = new URL('../scripts/verification-jobs.mjs', import.meta.url).href;
const { startVerification, waitVerification, verificationStatus, atomicJson, processIdentity, verificationEnvironment } = await import(jobsUrl);
const knownEnvironment = { test: 'known-fixture', reusable: true };

function repository(t: TestContext, task = "require('node:assert/strict').equal(require('node:fs').readFileSync('value','utf8'),'original')") {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  mkdirSync(join(root, 'scripts'));
  for (const file of ['check.mjs', 'check-runner.mjs', 'check-source.mjs', 'verification-jobs.mjs', 'verify.mjs', 'verification-worker.mjs']) cpSync(join(scripts, file), join(root, 'scripts', file));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'check-fixture', version: '1.0.0', private: true, scripts: { check: 'node scripts/check.mjs', typecheck: 'node task.cjs', test: 'node task.cjs', build: 'node task.cjs' } }));
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ name: 'check-fixture', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'check-fixture', version: '1.0.0' } } }));
  writeFileSync(join(root, '.gitignore'), 'logs/\nnode_modules/\n');
  writeFileSync(join(root, 'value'), 'original');
  writeFileSync(join(root, 'task.cjs'), task);
  git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  return { root, commit: git('rev-parse', 'HEAD'), git };
}

test('开发检查接受未提交内容，输出身份但不宣称正式验收', async t => {
  const { root } = repository(t, 'process.exit(0)');
  writeFileSync(join(root, 'new-file'), 'uncommitted');
  const result = await runCheck(root);
  assert.equal(result.status, 'passed');
  assert.equal(result.mode, 'development');
  assert.equal(result.source.dirty, true);
  const before = sourceIdentity(root);
  writeFileSync(join(root, 'new-file'), 'changed');
  assert.notEqual(sourceIdentity(root).fingerprint, before.fingerprint);
});

test('检查期间修改源码使结果失效并停止后续阶段', async t => {
  const { root } = repository(t, "require('node:fs').writeFileSync('value','changed')");
  const result = await runCheck(root);
  assert.equal(result.status, 'invalidated');
  assert.deepEqual(result.pending, ['test', 'build']);
});

test('固定提交验收与开发目录的未提交修改隔离', async t => {
  const { root, commit } = repository(t);
  const pending = verify(root, commit);
  writeFileSync(join(root, 'value'), 'developer continues');
  const result = await pending;
  assert.equal(result.status, 'passed', result.error);
  assert.equal(result.commit, commit);
  assert.equal(readFileSync(join(result.checkout, 'value'), 'utf8'), 'original');
  assert.equal(readFileSync(join(root, 'value'), 'utf8'), 'developer continues');
  assert.ok(readFileSync(result.checkSummary, 'utf8').includes(commit));
  assert.notEqual(result.checkout, root);
});

test('正式验收失败留存日志，不把退出失败记为通过', async t => {
  const { root, commit } = repository(t, 'process.exit(7)');
  const result = await verify(root, commit);
  assert.equal(result.status, 'failed');
  assert.match(readFileSync(join(result.directory, 'check.log'), 'utf8'), /failed/);
  assert.equal(JSON.parse(readFileSync(join(result.directory, 'summary.json'), 'utf8')).status, 'failed');
});

test('正式验收拒绝缺失提交以及安装过程中改变源码', async t => {
  const { root, git } = repository(t);
  await assert.rejects(verify(root, undefined), /必须指定/);
  await assert.rejects(verify(root, '--bad-option'), /Command failed/);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  pkg.scripts.prepare = "node -e \"require('fs').writeFileSync('value','changed')\"";
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
  git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'prepare');
  const result = await verify(root, 'HEAD');
  assert.equal(result.status, 'failed');
  assert.match(result.error, /依赖安装改变/);
});

test('相同身份并发启动只创建一个任务，状态包含稳定身份、阶段及心跳', async t => {
  const { root, commit } = repository(t, 'setTimeout(() => {}, 150)');
  const options = { environment: knownEnvironment };
  const jobs = await Promise.all([startVerification(root, commit, undefined, options), startVerification(root, commit, undefined, options)]);
  assert.equal(jobs[0].runId, jobs[1].runId);
  assert.equal(jobs.filter(job => job.attached).length, 1);
  const status = verificationStatus(jobs[0].directory);
  assert.equal(status.commit, commit);
  assert.ok(status.phase);
  assert.ok(Date.parse(status.heartbeatAt));
  const result = await waitVerification(status.directory, { pollMs: 20 });
  assert.equal(result.status, 'passed', result.error);
  const cli = JSON.parse(execFileSync(process.execPath, [join(root, 'scripts/verify.mjs'), 'status', '--run', result.runId], { encoding: 'utf8' }));
  assert.equal(cli.runId, result.runId);
  assert.equal(cli.status, 'passed');
  assert.equal(readdirSync(join(root, 'logs/verify')).filter(name => name.startsWith('run-')).length, 1);
});

test('独立检查不继承node:test父进程标记，嵌套测试实际执行', async t => {
  const { root } = repository(t, 'process.exit(0)');
  writeFileSync(join(root, 'nested.test.mjs'), "import {test} from 'node:test';import{writeFileSync}from'node:fs';test('真实执行',()=>writeFileSync('nested-ran','yes'));");
  const result = await runLogged(process.execPath, ['--test', 'nested.test.mjs'], root, join(root, 'nested.log'));
  assert.equal(result.status, 'passed');
  assert.equal(readFileSync(join(root, 'nested-ran'), 'utf8'), 'yes');
  assert.match(readFileSync(join(root, 'nested.log'), 'utf8'), /pass 1/);
});

test('等待连接退出后后台验收继续，再次启动连接原任务', async t => {
  const { root, commit } = repository(t, 'setTimeout(() => {}, 400)');
  const observer = spawn(process.execPath, ['--input-type=module', '-e', `
    import { startVerification, waitVerification } from ${JSON.stringify(jobsUrl)};
    const job = await startVerification(${JSON.stringify(root)}, ${JSON.stringify(commit)}, undefined, { environment: ${JSON.stringify(knownEnvironment)} });
    console.log(JSON.stringify({ directory: job.directory }));
    await waitVerification(job.directory);
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  const observed: any = await new Promise((resolve, reject) => {
    let text = '';
    observer.stdout.on('data', chunk => { text += chunk; if (text.includes('\n')) resolve(JSON.parse(text.split('\n')[0]!)); });
    observer.once('error', reject);
    observer.once('exit', code => { if (!text) reject(Error(`观察者提前退出 ${code}`)); });
  });
  observer.kill('SIGTERM');
  const same = await startVerification(root, commit, undefined, { environment: knownEnvironment });
  assert.equal(same.directory, observed.directory);
  assert.equal(same.attached, true);
  const result = await waitVerification(same.directory, { pollMs: 20 });
  assert.equal(result.status, 'passed', result.error);
});

test('环境不同不合并，失败重试生成新任务并保留失败摘要', async t => {
  const { root, commit } = repository(t, 'process.exit(7)');
  const first = await startVerification(root, commit, undefined, { environment: knownEnvironment });
  const different = await startVerification(root, commit, undefined, { environment: { ...knownEnvironment, test: 'other' } });
  assert.notEqual(first.runId, different.runId);
  const failed = await waitVerification(first.directory, { pollMs: 20 });
  assert.equal(failed.status, 'failed');
  assert.ok(failed.results.some((result: { status: string; failureSummary?: string }) => result.status === 'failed' && typeof result.failureSummary === 'string'));
  const retry = await startVerification(root, commit, undefined, { environment: knownEnvironment });
  assert.notEqual(first.runId, retry.runId);
  assert.equal(verificationStatus(first.directory).status, 'failed');
  await Promise.all([waitVerification(different.directory, { pollMs: 20 }), waitVerification(retry.directory, { pollMs: 20 })]);
});

test('历史成功仅显式复用，保留原runId和完成时间；默认重新验收', async t => {
  const { root, commit } = repository(t, 'process.exit(0)');
  const options = { environment: knownEnvironment };
  const first = await startVerification(root, commit, undefined, options);
  const passed = await waitVerification(first.directory, { pollMs: 20 });
  const reused = await startVerification(root, commit, undefined, { ...options, reusePassed: true });
  assert.equal(reused.runId, passed.runId);
  assert.equal(reused.completedAt, passed.completedAt);
  assert.equal(reused.reused, true);
  const fresh = await startVerification(root, commit, undefined, options);
  assert.notEqual(fresh.runId, passed.runId);
  await waitVerification(fresh.directory, { pollMs: 20 });
});

test('缺少原始证据或环境未知时拒绝复用历史成功', async t => {
  const { root, commit } = repository(t, 'process.exit(0)');
  const options = { environment: knownEnvironment };
  const first = await startVerification(root, commit, undefined, options);
  const passed = await waitVerification(first.directory, { pollMs: 20 });
  rmSync(join(passed.directory, 'check.log'));
  const replacement = await startVerification(root, commit, undefined, { ...options, reusePassed: true });
  assert.notEqual(replacement.runId, passed.runId);
  assert.equal(replacement.reused, false);
  await waitVerification(replacement.directory, { pollMs: 20 });
  const unknown = { environment: { test: 'unknown', reusable: false } };
  const third = await startVerification(root, commit, undefined, unknown);
  await waitVerification(third.directory, { pollMs: 20 });
  const fourth = await startVerification(root, commit, undefined, { ...unknown, reusePassed: true });
  assert.notEqual(third.runId, fourth.runId);
  await waitVerification(fourth.directory, { pollMs: 20 });
});

test('过期心跳不抢占活拥有者，确认退出后旧任务记为interrupted再重试', async t => {
  if (process.platform !== 'linux') { t.skip('进程启动身份与独立session恢复需要Linux /proc'); return; }
  const { root, commit } = repository(t, 'process.exit(0)');
  const options = { environment: knownEnvironment };
  const first = await startVerification(root, commit, undefined, options);
  await waitVerification(first.directory, { pollMs: 20 });
  const summary = JSON.parse(readFileSync(join(first.directory, 'summary.json'), 'utf8'));
  summary.status = 'running'; summary.phase = 'check'; summary.owner = processIdentity(); summary.heartbeatAt = '2000-01-01T00:00:00.000Z';
  atomicJson(join(first.directory, 'summary.json'), summary);
  atomicJson(join(first.directory, 'worker-owner.json'), { owner: summary.owner });
  assert.equal(verificationStatus(first.directory).status, 'running');
  assert.match(verificationStatus(first.directory).observation, /心跳过期/);
  const attached = await startVerification(root, commit, undefined, options);
  assert.equal(attached.runId, first.runId);
  atomicJson(join(first.directory, 'worker-owner.json'), { owner: { ...processIdentity(), pid: 2147483647 } });
  assert.equal(verificationStatus(first.directory).status, 'interrupted');
  const retry = await startVerification(root, commit, undefined, options);
  assert.notEqual(retry.runId, first.runId);
  assert.equal(JSON.parse(readFileSync(join(first.directory, 'summary.json'), 'utf8')).status, 'interrupted');
  await waitVerification(retry.directory, { pollMs: 20 });
});

test('拥有者退出但独立session仍有子进程时不重复启动', async t => {
  if (process.platform !== 'linux') { t.skip('进程组身份需要Linux /proc'); return; }
  const { root, commit } = repository(t, 'process.exit(0)');
  const options = { environment: knownEnvironment };
  const first = await startVerification(root, commit, undefined, options);
  await waitVerification(first.directory, { pollMs: 20 });
  const guardian = spawn(process.execPath, ['-e', "require('node:child_process').spawn(process.execPath,['-e','setTimeout(() => {}, 800)'],{stdio:'ignore'});setTimeout(() => process.exit(0), 100)"], { detached: true, stdio: 'ignore' });
  const owner = processIdentity(guardian.pid);
  assert.ok(owner);
  await new Promise(resolve => guardian.once('exit', resolve));
  const summary = JSON.parse(readFileSync(join(first.directory, 'summary.json'), 'utf8'));
  atomicJson(join(first.directory, 'summary.json'), { ...summary, status: 'running', phase: 'check', owner, heartbeatAt: '2000-01-01T00:00:00.000Z' });
  atomicJson(join(first.directory, 'worker-owner.json'), { owner });
  assert.equal(verificationStatus(first.directory).status, 'running');
  assert.match(verificationStatus(first.directory).observation, /子进程结束尚未确认/);
  const attached = await startVerification(root, commit, undefined, options);
  assert.equal(attached.runId, first.runId);
  await new Promise(resolve => setTimeout(resolve, 850));
  assert.equal(verificationStatus(first.directory).status, 'interrupted');
});

test('跨PID命名空间和新鲜心跳拥有者不可见时不判中断、不重复启动', async t => {
  if (process.platform !== 'linux') { t.skip('PID命名空间身份需要Linux /proc'); return; }
  const { root, commit } = repository(t, 'process.exit(0)');
  const options = { environment: knownEnvironment };
  const first = await startVerification(root, commit, undefined, options);
  await waitVerification(first.directory, { pollMs: 20 });
  const summary = JSON.parse(readFileSync(join(first.directory, 'summary.json'), 'utf8'));
  const now = new Date().toISOString();
  const local = { ...processIdentity(), pid: 2147483647 };
  atomicJson(join(first.directory, 'summary.json'), { ...summary, status: 'running', phase: 'check', owner: local, heartbeatAt: now });
  atomicJson(join(first.directory, 'worker-owner.json'), { owner: local });
  assert.equal(verificationStatus(first.directory).status, 'running');
  assert.match(verificationStatus(first.directory).observation, /心跳仍新鲜/);
  const outside = { ...local, pidNamespace: 'pid:[different-namespace]' };
  atomicJson(join(first.directory, 'worker-owner.json'), { owner: outside });
  atomicJson(join(first.directory, 'summary.json'), { ...summary, status: 'running', phase: 'check', owner: outside, heartbeatAt: '2000-01-01T00:00:00.000Z' });
  assert.equal(verificationStatus(first.directory).status, 'running');
  const attached = await startVerification(root, commit, undefined, options);
  assert.equal(attached.runId, first.runId);
  assert.equal(attached.attached, true);
});

test('字体配置或NODE_ENV改变会改变有效验收环境，测试上下文标记被剥离', t => {
  const before = { node: process.env.NODE_ENV, font: process.env.FONTCONFIG_FILE, context: process.env.NODE_TEST_CONTEXT };
  t.after(() => {
    for (const [key, value] of [['NODE_ENV', before.node], ['FONTCONFIG_FILE', before.font], ['NODE_TEST_CONTEXT', before.context]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  process.env.NODE_ENV = 'clapgrid-retro-a';
  const first = verificationEnvironment();
  process.env.NODE_ENV = 'clapgrid-retro-b';
  assert.notEqual(verificationEnvironment().environmentFingerprint, first.environmentFingerprint);
  const second = verificationEnvironment();
  process.env.FONTCONFIG_FILE = '/nonexistent/clapgrid-fontconfig';
  const third = verificationEnvironment();
  assert.notEqual(third.environmentFingerprint, second.environmentFingerprint);
  assert.equal(third.reusable, false);
  process.env.NODE_TEST_CONTEXT = 'must-not-affect-effective-environment';
  assert.equal(verificationEnvironment().environmentFingerprint, third.environmentFingerprint);
});
