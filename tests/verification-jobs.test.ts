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
const { withCheckRun, stopCheckRun, currentCheckRun, reserveCheckRun, releaseCheckReservation } = await import(new URL('../scripts/check-lifecycle.mjs', import.meta.url).href);
const { checkUi } = await import(new URL('../scripts/check-ui.mjs', import.meta.url).href);
const jobsUrl = new URL('../scripts/verification-jobs.mjs', import.meta.url).href;
const { startVerification, waitVerification, verificationStatus, atomicJson, processIdentity, verificationEnvironment, cancelVerification } = await import(jobsUrl);
const knownEnvironment = { test: 'known-fixture', reusable: true };

function restoreRegistration(summary: any, owner: any, group?: any) {
  const directory = join(summary.lifecycleRoot, 'logs/check-state/active');
  mkdirSync(directory, { recursive: true });
  atomicJson(join(directory, 'owner.json'), { token: summary.token, root: summary.lifecycleRoot, kind: 'verification', reservation: false,
    pid: owner.pid, birth: owner.start, namespace: owner.pidNamespace, verificationKey: summary.key, verificationDirectory: summary.directory });
  if (group) atomicJson(join(directory, `group-${group.pid}.json`), group);
}

async function until(check: () => boolean, message: string) {
  const deadline = Date.now() + 10000;
  while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(check(), message);
}

function repository(t: TestContext, task = "require('node:assert/strict').equal(require('node:fs').readFileSync('value','utf8'),'original')") {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  mkdirSync(join(root, 'scripts'));
  for (const file of ['check.mjs', 'check-runner.mjs', 'check-source.mjs', 'check-lifecycle.mjs', 'test-runner.mjs', 'test-reporter.mjs', 'verification-jobs.mjs', 'verify.mjs', 'verification-worker.mjs']) cpSync(join(scripts, file), join(root, 'scripts', file));
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
  assert.equal(result.preflight.status, 'invalidated');
  assert.deepEqual(result.pending, []);
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
  const result = await withCheckRun(root, 'fixture', (context: any) => runLogged(process.execPath, ['--test', 'nested.test.mjs'], root, join(root, 'nested.log'), context));
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
  await assert.rejects(startVerification(root, commit, undefined, { environment: { ...knownEnvironment, test: 'other' } }), /不同身份/);
  const failed = await waitVerification(first.directory, { pollMs: 20 });
  assert.equal(failed.status, 'failed');
  assert.ok(failed.results.some((result: { status: string; failureSummary?: string }) => result.status === 'failed' && typeof result.failureSummary === 'string'));
  const retry = await startVerification(root, commit, undefined, { environment: knownEnvironment });
  assert.notEqual(first.runId, retry.runId);
  assert.equal(verificationStatus(first.directory).status, 'failed');
  await waitVerification(retry.directory, { pollMs: 20 });
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
  restoreRegistration(summary, summary.owner);
  assert.equal(verificationStatus(first.directory).status, 'running');
  assert.match(verificationStatus(first.directory).observation, /心跳过期/);
  const attached = await startVerification(root, commit, undefined, options);
  assert.equal(attached.runId, first.runId);
  atomicJson(join(first.directory, 'worker-owner.json'), { owner: { ...processIdentity(), pid: 2147483647 } });
  restoreRegistration(summary, { ...processIdentity(), pid: 2147483647 });
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
  restoreRegistration(summary, owner, { pid: owner.pid, birth: owner.start });
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
  restoreRegistration(summary, local);
  assert.equal(verificationStatus(first.directory).status, 'running');
  assert.match(verificationStatus(first.directory).observation, /心跳仍新鲜/);
  const outside = { ...local, pidNamespace: 'pid:[different-namespace]' };
  atomicJson(join(first.directory, 'worker-owner.json'), { owner: outside });
  atomicJson(join(first.directory, 'summary.json'), { ...summary, status: 'running', phase: 'check', owner: outside, heartbeatAt: '2000-01-01T00:00:00.000Z' });
  restoreRegistration(summary, outside);
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

test('预约启动与普通检查、UI快检共用互斥锁，只有相同令牌可接管', async t => {
  const { root, commit } = repository(t, 'process.exit(0)');
  const reservation = reserveCheckRun(root, 'verification', { verificationKey: 'fixture' });
  try {
    await assert.rejects(runCheck(root), /已有检查/);
    await assert.rejects(checkUi(root), /已有检查/);
    await assert.rejects(startVerification(root, commit, undefined, { environment: knownEnvironment }), /不同身份/);
    await assert.rejects(withCheckRun(root, 'verification', () => {}, { reservation: 'wrong-token' }), /预约身份/);
    assert.equal(currentCheckRun(root).token, reservation.token);
    await withCheckRun(root, 'verification', () => {}, { reservation: reservation.token });
    assert.equal(currentCheckRun(root), null);
  } finally { releaseCheckReservation(root, reservation.token); }
});

test('后台任务显式取消清理不同session的子进程，CLI返回130，旧runId不能取消新任务', { skip: process.platform === 'win32' }, async t => {
  const task = `const{spawn}=require('node:child_process');const fs=require('node:fs');fs.mkdirSync('logs',{recursive:true});
    spawn(process.execPath,['-e','setInterval(()=>require("node:fs").appendFileSync("logs/heartbeat","x"),20)'],{stdio:'ignore'});setInterval(()=>{},1000);`;
  const { root, commit, git } = repository(t, task);
  try {
    const first = await startVerification(root, commit, undefined, { environment: knownEnvironment });
    const heartbeat = join(first.checkout, 'logs/heartbeat');
    await until(() => { try { return readFileSync(heartbeat, 'utf8').length > 0; } catch { return false; } }, '子进程应实际运行');
    try { execFileSync(process.execPath, [join(root, 'scripts/verify.mjs'), 'cancel', '--run', first.runId], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); assert.fail('取消应返回130'); }
    catch (error: any) { assert.equal(error.status, 130); assert.equal(JSON.parse(error.stdout).status, 'cancelled'); }
    const ended = verificationStatus(first.directory);
    assert.equal(ended.status, 'cancelled'); assert.equal(currentCheckRun(root), null);
    const before = readFileSync(heartbeat, 'utf8'); await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(readFileSync(heartbeat, 'utf8'), before, '取消完成后孙进程不能继续写入');
    writeFileSync(join(root, 'task.cjs'), 'setTimeout(()=>{},150)');
    git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'next');
    const next = await startVerification(root, 'HEAD', undefined, { environment: knownEnvironment });
    atomicJson(join(first.directory, 'summary.json'), { ...ended, status: 'running', heartbeatAt: new Date().toISOString() });
    await assert.rejects(cancelVerification(root, first.directory), /身份已变化/);
    assert.equal(currentCheckRun(root).token, next.token);
    assert.equal((await waitVerification(next.directory, { pollMs: 20 })).status, 'passed');
  } finally { if (currentCheckRun(root)) await stopCheckRun(root); }
});

test('worker退出但登记的另一session仍活着时不判中断，显式清理后才允许重试', { skip: process.platform !== 'linux' }, async t => {
  const { root, commit } = repository(t, 'require("node:fs").mkdirSync("logs",{recursive:true});setInterval(()=>require("node:fs").appendFileSync("logs/heartbeat","x"),20)');
  try {
    const job = await startVerification(root, commit, undefined, { environment: knownEnvironment });
    await until(() => { try { return readFileSync(join(job.checkout, 'logs/heartbeat'), 'utf8').length > 0; } catch { return false; } }, '登记的独立子进程组应运行');
    process.kill(job.owner.pid, 'SIGKILL');
    await until(() => { try { return readFileSync(`/proc/${job.owner.pid}/stat`, 'utf8').includes(') Z '); } catch { return true; } }, 'worker应退出');
    const summary = JSON.parse(readFileSync(join(job.directory, 'summary.json'), 'utf8'));
    atomicJson(join(job.directory, 'summary.json'), { ...summary, heartbeatAt: '2000-01-01T00:00:00.000Z' });
    const observed = verificationStatus(job.directory);
    assert.equal(observed.status, 'running'); assert.match(observed.observation, /子进程结束尚未确认/);
    assert.equal((await startVerification(root, commit, undefined, { environment: knownEnvironment })).runId, job.runId);
    await stopCheckRun(root);
    assert.equal(verificationStatus(job.directory).status, 'interrupted');
    assert.equal(currentCheckRun(root), null);
  } finally { if (currentCheckRun(root)) await stopCheckRun(root); }
});

test('历史复用必须保留通过的预检和完整结构化报告', async t => {
  const { root, commit } = repository(t, 'process.exit(0)');
  const options = { environment: knownEnvironment, reusePassed: true };
  const first = await startVerification(root, commit, undefined, options);
  const passed = await waitVerification(first.directory, { pollMs: 20 });
  const check = JSON.parse(readFileSync(passed.checkSummary, 'utf8'));
  check.preflight.status = 'failed'; atomicJson(passed.checkSummary, check);
  const second = await startVerification(root, commit, undefined, options);
  assert.notEqual(second.runId, first.runId);
  const next = await waitVerification(second.directory, { pollMs: 20 });
  const nextCheck = JSON.parse(readFileSync(next.checkSummary, 'utf8'));
  nextCheck.preflight.results[0].exitCode = 7;
  atomicJson(next.checkSummary, nextCheck);
  const inconsistent = await startVerification(root, commit, undefined, options);
  assert.notEqual(inconsistent.runId, second.runId, '顶层passed不能掩盖预检子阶段的失败');
  const complete = await waitVerification(inconsistent.directory, { pollMs: 20 });
  const completeCheck = JSON.parse(readFileSync(complete.checkSummary, 'utf8'));
  const report = join(next.directory, 'broken-report.json'); atomicJson(report, { complete: false, failures: [] });
  completeCheck.results.find((stage: any) => stage.name === 'test').testReport = report;
  atomicJson(complete.checkSummary, completeCheck);
  const third = await startVerification(root, commit, undefined, options);
  assert.notEqual(third.runId, inconsistent.runId);
  assert.equal(third.reused, false);
  await waitVerification(third.directory, { pollMs: 20 });
});

test('取消父检查覆盖其启动的独立后台worker及子命令，嵌套祖先登记完整保留', async t => {
  const nested = repository(t, 'require("node:fs").mkdirSync("logs",{recursive:true});setInterval(()=>require("node:fs").appendFileSync("logs/heartbeat","x"),20)');
  const launch = `import{startVerification,waitVerification}from${JSON.stringify(jobsUrl)};const job=await startVerification(${JSON.stringify(nested.root)},'HEAD',undefined,{environment:${JSON.stringify(knownEnvironment)}});await waitVerification(job.directory);`;
  const task = `require('node:child_process').spawn(process.execPath,['--input-type=module','-e',${JSON.stringify(launch)}],{stdio:'ignore'});setInterval(()=>{},1000);`;
  const { root } = repository(t, task);
  const controller = new AbortController();
  const pending = runCheck(root, undefined, { signal: controller.signal });
  let heartbeat = '';
  try {
    await until(() => {
      try {
        const run = readdirSync(join(nested.root, 'logs/verify')).find(name => name.startsWith('run-'));
        if (!run) return false;
        heartbeat = join(nested.root, 'logs/verify', run, 'source/logs/heartbeat');
        return readFileSync(heartbeat, 'utf8').length > 0;
      } catch { return false; }
    }, '嵌套后台任务应启动并实际写入');
  } finally { controller.abort(); }
  try {
    assert.equal((await pending).status, 'cancelled');
    await until(() => !currentCheckRun(nested.root), '后台worker应完成取消并释放自己的锁');
    const before = readFileSync(heartbeat, 'utf8'); await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(readFileSync(heartbeat, 'utf8'), before, '父检查取消后后台子任务不能继续运行');
  } finally { if (currentCheckRun(nested.root)) await stopCheckRun(nested.root); }
});
