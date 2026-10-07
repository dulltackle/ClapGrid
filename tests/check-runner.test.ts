import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  for (const file of ['check.mjs', 'check-runner.mjs', 'check-source.mjs']) cpSync(join(scripts, file), join(root, 'scripts', file));
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
