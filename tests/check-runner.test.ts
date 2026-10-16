import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));
const runnerUrl = new URL('../scripts/check-runner.mjs', import.meta.url).href;
const verifyUrl = new URL('../scripts/verify.mjs', import.meta.url).href;
const identityUrl = new URL('../scripts/check-source.mjs', import.meta.url).href;
const { runCheck } = await import(runnerUrl);
const { verify } = await import(verifyUrl);
const { sourceIdentity } = await import(identityUrl);

function repository(t: TestContext, task = "require('node:assert/strict').equal(require('node:fs').readFileSync('value','utf8'),'original')") {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  mkdirSync(join(root, 'scripts'));
  for (const file of ['check.mjs', 'check-runner.mjs', 'check-source.mjs', 'check-lifecycle.mjs']) cpSync(join(scripts, file), join(root, 'scripts', file));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'check-fixture', version: '1.0.0', private: true, scripts: { check: 'node scripts/check.mjs', typecheck: 'node task.cjs', test: 'node task.cjs', 'test:failed': 'node task.cjs', build: 'node task.cjs' } }));
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

test('检查进度及命令输出不混入原生测试器的 V8 stdout 通道', async t => {
  const { root } = repository(t, `require('node:assert/strict').equal(process.env.NODE_TEST_CONTEXT,undefined);console.log('命令中文输出');`);
  const raw: string[] = [];
  const write = process.stdout.write;
  // 保留原生事件帧；截获普通输出，稳定检测帧混入而不依赖管道合包时机。
  process.stdout.write = function (this: typeof process.stdout, chunk: any, ...args: any[]) {
    if (!Buffer.isBuffer(chunk) || chunk[0] !== 0xff || chunk[1] !== 0x0f) {
      raw.push(String(chunk));
      return (process.stderr.write as any)(chunk, ...args);
    }
    return (write as any).call(this, chunk, ...args);
  } as typeof write;
  let result;
  try { result = await runCheck(root); }
  finally { process.stdout.write = write; }
  assert.deepEqual(raw, [], '进度与子命令输出必须走 stderr，stdout 只传原生测试事件');
  assert.equal(result.status, 'passed');
  assert.match(readFileSync(join(result.directory, 'test.log'), 'utf8'), /命令中文输出/);
});

test('检查期间修改源码使结果失效并停止后续阶段', async t => {
  const { root } = repository(t, "require('node:fs').writeFileSync('value','changed')");
  const result = await runCheck(root);
  assert.equal(result.status, 'invalidated');
  assert.equal(result.preflight.status, 'invalidated');
  assert.equal(existsSync(join(result.directory, '..', 'test.log')), false, '预检源码失效后不能运行完整测试');
});

async function until(check: () => boolean, message: string) {
  const deadline = Date.now() + 8000;
  while (!check() && Date.now() < deadline) await delay(25);
  assert.ok(check(), message);
}

test('同工作树拒绝 check 与 verify 重复启动，不同目录独立；取消后可重新启动', async t => {
  const { root, commit } = repository(t, 'setTimeout(()=>{},20000)');
  const controller = new AbortController();
  const running = runCheck(root, undefined, { signal: controller.signal });
  try {
    await until(() => existsSync(join(root, 'logs/check-state/active/owner.json')), '应取得运行锁');
    await assert.rejects(runCheck(root), /已有检查/);
    await assert.rejects(verify(root, commit), /已有检查/);
    const other = mkdtempSync(join(tmpdir(), 'clapgrid-check-worktree-'));
    t.after(() => rmSync(other, { recursive: true, force: true }));
    execFileSync('git', ['-C', root, 'worktree', 'add', '--quiet', '--detach', other, commit]);
    writeFileSync(join(other, 'task.cjs'), 'process.exit(0)');
    assert.equal((await runCheck(other)).status, 'passed', '共享 Git 主目录的另一工作树仍可独立检查');
  } finally { controller.abort(); }
  assert.equal((await running).status, 'cancelled');
  assert.equal(existsSync(join(root, 'logs/check-state/active')), false);
  writeFileSync(join(root, 'task.cjs'), 'process.exit(0)');
  assert.equal((await runCheck(root)).status, 'passed');
});

test('取消会停止仍存活的孙进程并留存 cancelled 记录，不启动后续阶段', { skip: process.platform === 'win32' }, async t => {
  const task = `const {spawn}=require('node:child_process'); const fs=require('node:fs');
    fs.writeFileSync(process.env.CLAPGRID_TEST_REPORT,'{');
    const child=spawn(process.execPath,['-e', 'setInterval(()=>require("node:fs").appendFileSync("heartbeat","x"),30)'],{stdio:'ignore'});
    fs.writeFileSync('grandchild',String(child.pid)); setInterval(()=>{},1000);`;
  const { root } = repository(t, task);
  const child = spawn(process.execPath, ['scripts/check.mjs'], { cwd: root, stdio: 'ignore' });
  t.after(() => { try { child.kill('SIGKILL'); } catch {} });
  await until(() => existsSync(join(root, 'heartbeat')), '孙进程应启动');
  child.kill('SIGTERM');
  await new Promise(resolve => child.once('exit', resolve));
  const before = readFileSync(join(root, 'heartbeat'), 'utf8'); await delay(150);
  assert.equal(readFileSync(join(root, 'heartbeat'), 'utf8'), before, '孙进程不能在取消后继续运行');
  assert.equal(existsSync(join(root, 'logs/check-state/active')), false);
  const preflightDirectory = readdirSync(join(root, 'logs/check'), { recursive: true }).filter(file => String(file).endsWith('summary.json')).map(file => join(root, 'logs/check', String(file)));
  assert.ok(preflightDirectory.some(path => JSON.parse(readFileSync(path, 'utf8')).status === 'cancelled'));
});

test('检查组长提前退出仍会清理忽略 SIGTERM 的孙进程', { skip: process.platform === 'win32' }, async t => {
  const task = `const {spawn}=require('node:child_process'); const fs=require('node:fs');
    const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>require("node:fs").appendFileSync("logs/heartbeat","x"),20)'],{stdio:'ignore'});
    child.unref();const timer=setInterval(()=>{if(fs.existsSync('logs/heartbeat')){clearInterval(timer);process.exit(0);}},10);`;
  const { root } = repository(t, task);
  assert.equal((await runCheck(root)).status, 'passed');
  const before = readFileSync(join(root, 'logs/heartbeat'), 'utf8'); await delay(120);
  assert.equal(readFileSync(join(root, 'logs/heartbeat'), 'utf8'), before);
});

test('显式停止可恢复拥有者异常退出后的锁，并清理其仍运行的子进程', { skip: process.platform === 'win32' }, async t => {
  const { root } = repository(t, 'require("node:fs").appendFileSync("heartbeat","x");setInterval(()=>require("node:fs").appendFileSync("heartbeat","x"),30)');
  const child = spawn(process.execPath, ['scripts/check.mjs'], { cwd: root, stdio: 'ignore' });
  const exited = new Promise(resolve => child.once('exit', resolve));
  await until(() => existsSync(join(root, 'heartbeat')), '检查阶段已运行');
  child.kill('SIGKILL'); await exited;
  await assert.rejects(runCheck(root), /已有检查/);
  const { stopCheckRun } = await import(new URL('../scripts/check-lifecycle.mjs', import.meta.url).href);
  assert.equal((await stopCheckRun(root)).status, 'cancelled');
  const before = readFileSync(join(root, 'heartbeat'), 'utf8'); await delay(150);
  assert.equal(readFileSync(join(root, 'heartbeat'), 'utf8'), before);
  assert.equal(existsSync(join(root, 'logs/check-state/active')), false);
});

test('停止通过控制通道交给拥有者，不依赖调用者可见的 PID', async t => {
  const { root } = repository(t, 'require("node:fs").writeFileSync("started","yes");setTimeout(()=>{},20000)');
  const child = spawn(process.execPath, ['scripts/check.mjs'], { cwd: root, stdio: 'ignore' });
  const exited = new Promise(resolve => child.once('exit', resolve));
  await until(() => existsSync(join(root, 'started')), '拥有者已开始运行');
  const path = join(root, 'logs/check-state/active/owner.json');
  const owner = JSON.parse(readFileSync(path, 'utf8'));
  // 模拟另一个终端命名空间：记录的 PID 对当前调用者不可见。
  writeFileSync(path, JSON.stringify({ ...owner, pid: 2147483647, namespace: 'other-namespace' }));
  const { stopCheckRun } = await import(new URL('../scripts/check-lifecycle.mjs', import.meta.url).href);
  assert.equal((await stopCheckRun(root)).status, 'cancelled');
  await exited;
  assert.equal(existsSync(join(root, 'logs/check-state/active')), false);
});

test('控制通道不可达且无法确认跨命名空间拥有者已死时保留锁', async t => {
  const { root } = repository(t);
  const directory = join(root, 'logs/check-state/active');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'owner.json'), JSON.stringify({ pid: 2147483647, namespace: 'other-namespace', token: 'unreachable', birth: 'unknown' }));
  const { stopCheckRun } = await import(new URL('../scripts/check-lifecycle.mjs', import.meta.url).href);
  await assert.rejects(stopCheckRun(root), /无法确认旧任务退出/);
  assert.equal(existsSync(directory), true);
  await assert.rejects(runCheck(root), /已有检查/);
});

test('嵌套 verify 取消覆盖独立检出内 check 的进程组', async t => {
  const { root, commit } = repository(t, 'require("node:fs").writeFileSync("started","yes");setTimeout(()=>{},20000)');
  const controller = new AbortController();
  const pending = verify(root, commit, undefined, { signal: controller.signal });
  await until(() => existsSync(join(root, 'logs/verify')) && readdirSync(join(root, 'logs/verify')).some(run => existsSync(join(root, 'logs/verify', run, 'source/started'))), '独立检出中的阶段应启动');
  controller.abort();
  const result = await pending;
  assert.equal(result.status, 'cancelled');
  assert.equal(existsSync(join(root, 'logs/check-state/active')), false);
});

test('取消覆盖命令内另一个工作树子检查新建的进程组', { skip: process.platform === 'win32' }, async t => {
  const nested = repository(t, 'setInterval(()=>require("node:fs").appendFileSync("heartbeat","x"),30)');
  const task = `require('node:child_process').spawn(process.execPath,${JSON.stringify([join(nested.root, 'scripts/check.mjs')])},{cwd:${JSON.stringify(nested.root)},stdio:'ignore'});setInterval(()=>{},1000);`;
  const { root } = repository(t, task);
  const controller = new AbortController();
  const pending = runCheck(root, undefined, { signal: controller.signal });
  await until(() => existsSync(join(nested.root, 'heartbeat')), '子工作树检查已启动');
  controller.abort();
  assert.equal((await pending).status, 'cancelled');
  const before = readFileSync(join(nested.root, 'heartbeat'), 'utf8'); await delay(150);
  assert.equal(readFileSync(join(nested.root, 'heartbeat'), 'utf8'), before, '子检查的独立进程组也必须停止');
});

test('失败后集中复验全部失败阶段，仍失败时阻止新的完整检查', async t => {
  const { root } = repository(t, 'process.exit(0)');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  pkg.scripts.test = 'node -e "process.exit(7)"';
  pkg.scripts['test:failed'] = 'node -e "process.exit(8)"';
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
  const first = await runCheck(root);
  assert.equal(first.status, 'failed');
  const second = await runCheck(root);
  assert.equal(second.blocked, true);
  assert.deepEqual(second.results.map((result: any) => result.name), ['test:failed']);
  pkg.scripts['test:failed'] = 'node task.cjs'; pkg.scripts.test = 'node task.cjs';
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
  const repaired = await runCheck(root);
  assert.equal(repaired.status, 'passed');
  assert.equal(repaired.recheck.status, 'passed');
  assert.equal(existsSync(join(root, 'logs/check-state/failures.json')), false);
});

test('损坏的测试报告记入失败阶段并阻止未通过的复验放行', async t => {
  const { root } = repository(t, `if(['test','test:failed'].includes(process.env.npm_lifecycle_event))require('node:fs').writeFileSync(process.env.CLAPGRID_TEST_REPORT,'{');`);
  const result = await runCheck(root);
  assert.equal(result.status, 'failed');
  assert.equal(result.results.find((item: any) => item.name === 'test').status, 'failed');
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'logs/check-state/failures.json'), 'utf8')).stages, ['test']);
  const retry = await runCheck(root);
  assert.equal(retry.blocked, true);
  assert.deepEqual(retry.results.map((item: any) => item.name), ['test:failed']);
});

test('预检失败不启动完整检查且固定提交不接受旧预检证据', async t => {
  const { root, git } = repository(t, 'process.exit(0)');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  pkg.checkPreflight = ['quick'];
  pkg.scripts.quick = 'node -e "process.exit(9)"';
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
  git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'quick');
  const result = await verify(root, 'HEAD');
  assert.equal(result.status, 'failed');
  assert.match(result.error, /预检未通过/);
  assert.equal(existsSync(join(result.checkout, 'logs/check-state')), false, '嵌套检查复用父运行范围');
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
