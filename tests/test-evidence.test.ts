import { createHash } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
function repository(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-evidence-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'tests'));
  for (const name of readdirSync(join(project, 'scripts')).filter(name => name.endsWith('.mjs'))) cpSync(join(project, 'scripts', name), join(root, 'scripts', name));
  const files = [{ file: 'tests/sample.test.ts', executor: 'node', scopes: ['all', 'tooling', 'rows'] }];
  writeFileSync(join(root, 'scripts/test-inventory.json'), JSON.stringify({ schemaVersion: 1, files }));
  writeFileSync(join(root, 'tests/sample.test.ts'), `import {test} from 'node:test'; test('已登记场景',()=>{});`);
  writeFileSync(join(root, '.gitignore'), 'node_modules\nlogs/\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module', checkPreflight: ['typecheck', 'test:tooling'], scripts: { check: 'node scripts/check.mjs', typecheck: 'node -e ""', test: 'node scripts/test-runner.mjs', 'test:tooling': 'node scripts/test-runner.mjs --suite tooling', 'test:failed': 'node scripts/test-runner.mjs --suite failed', build: 'node -e ""' } }));
  writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}');
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q'); git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  const env: NodeJS.ProcessEnv = { ...process.env, CLAPGRID_TEST_REPORT: join(root, 'logs/report.json') }; delete env.NODE_TEST_CONTEXT;
  const command = (...args: string[]) => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env });
  return { root, command, files, git, env };
}

test('真实测试入口拒绝未登记、丢失和重复归属的测试文件', t => {
  const { root, command, files } = repository(t);
  writeFileSync(join(root, 'tests/new.test.ts'), `import {test} from 'node:test';test('新增',()=>{});`);
  assert.notEqual(command('scripts/test-runner.mjs').status, 0, '新增文件不能被静默接纳');
  rmSync(join(root, 'tests/new.test.ts'));
  writeFileSync(join(root, 'scripts/test-inventory.json'), JSON.stringify({ schemaVersion: 1, files: [...files, ...files] }));
  assert.notEqual(command('scripts/test-runner.mjs').status, 0, '一个文件不能有重复执行者');
  writeFileSync(join(root, 'scripts/test-inventory.json'), JSON.stringify({ schemaVersion: 1, files }));
  rmSync(join(root, 'tests/sample.test.ts'));
  assert.notEqual(command('scripts/test-runner.mjs').status, 0);
  writeFileSync(join(root, 'tests/sample.test.ts'), `import {test} from 'node:test';test('仍需归属',()=>{});`);
  rmSync(join(root, 'scripts/test-inventory.json'));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  pkg.scripts.test = pkg.scripts['test:tooling'] = 'node -e \"\"';
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
  assert.notEqual(command('scripts/check.mjs').status, 0, '缺清单不能把有测试的项目退化为空检查');
});

test('真实入口保存逐用例统一证据、原生来源与已登记预期集合', t => {
  const { root, command } = repository(t);
  const result = command('scripts/test-runner.mjs');
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(join(root, 'logs/report.json'), 'utf8'));
  assert.equal(report.kind, 'test-execution');
  assert.equal(report.status, 'passed');
  assert.equal(report.executor.name, 'node');
  assert.equal(report.executor.version, process.version);
  assert.deepEqual(report.expected.files, ['tests/sample.test.ts']);
  assert.deepEqual(report.actual.files.map((file: any) => file.file), ['tests/sample.test.ts']);
  assert.equal(report.expected.cases[0].name, '已登记场景');
  assert.equal(report.actual.cases[0].status, 'passed');
  assert.ok(report.identity.source.fingerprint && report.identity.config && report.identity.environment);
  assert.ok(report.startedAt <= report.completedAt);
  assert.equal(JSON.parse(readFileSync(report.sources.native.path, 'utf8')).cases[0].name, '已登记场景');
  assert.match(result.stdout, /预期执行.*sample\.test\.ts/s);
});

test('完整命令拒绝零退出的缺报告/不完整执行/篡改来源，失败进入待办并集中复验', t => {
  const { root, command } = repository(t);
  const reportPath = join(root, 'logs/report.json');
  // 先证明正常完整入口沿用预检与完整执行（本工单不去重）。
  const normal = command('scripts/check.mjs');
  assert.equal(normal.status, 0, normal.stderr);
  const pkgPath = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.scripts.test = `node -e ""`;
  writeFileSync(pkgPath, JSON.stringify(pkg));
  const missing = command('scripts/check.mjs');
  assert.notEqual(missing.status, 0, '成功退出不能替代实际报告');
  const failures = JSON.parse(readFileSync(join(root, 'logs/check-state/failures.json'), 'utf8'));
  assert.ok(failures.stages.includes('test'));
  assert.equal(command('scripts/check.mjs', '--failed').status, 0, '当前源码失败文件集中复验应解除阻塞');
  assert.equal(command('scripts/test-runner.mjs').status, 0);
  for (const mutation of [
    `report.complete=false`,
    `report.actual.files=[]`,
    `report.actual.cases=[]`,
    `report.identity.source.fingerprint='wrong'`,
    `report.errors=['unhandledRejection']`,
    `report.expected.files=['tests/other.test.ts']`,
    `report.actual.cases[0].status='cancelled'`,
    `require('fs').writeFileSync(report.sources.native.path,'{}')`,
  ]) {
    // 在本阶段真实执行后注入报告故障；命令仍退出 0，不能只凭状态放行。
    writeFileSync(join(root, 'inject.cjs'), `require('child_process').execFileSync(process.execPath,['scripts/test-runner.mjs'],{stdio:'inherit'});const fs=require('fs');const report=JSON.parse(fs.readFileSync(process.env.CLAPGRID_TEST_REPORT,'utf8'));${mutation};fs.writeFileSync(process.env.CLAPGRID_TEST_REPORT,JSON.stringify(report));`);
    pkg.scripts.test = 'node inject.cjs'; writeFileSync(pkgPath, JSON.stringify(pkg));
    assert.notEqual(command('scripts/check.mjs').status, 0, mutation);
    assert.equal(command('scripts/check.mjs', '--failed').status, 0);
  }
});

test('固定提交正式入口核对统一报告，显式复用拒绝损坏的原始与逐项证据', t => {
  const { root, command } = repository(t);
  const verify = () => {
    const result = command('scripts/verify.mjs', '--revision', 'HEAD', '--reuse-passed');
    assert.equal(result.status, 0, result.stderr + result.stdout);
    return JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
  };
  const first = verify();
  assert.equal(first.status, 'passed');
  const same = verify();
  assert.equal(same.runId, first.runId);
  assert.equal(same.reused, true);
  assert.equal(same.completedAt, first.completedAt);
  const summary = JSON.parse(readFileSync(first.checkSummary, 'utf8'));
  const testStage = summary.results.find((item: any) => item.name === 'test');
  const report = JSON.parse(readFileSync(testStage.testReport, 'utf8'));
  report.actual.cases = [];
  writeFileSync(testStage.testReport, JSON.stringify(report));
  const next = verify();
  assert.notEqual(next.runId, first.runId);
  assert.notEqual(next.reused, true);
  const nextSummary = JSON.parse(readFileSync(next.checkSummary, 'utf8'));
  const nextReport = JSON.parse(readFileSync(nextSummary.preflight.results.find((item: any) => item.testReport).testReport, 'utf8'));
  rmSync(nextReport.sources.native.path);
  assert.notEqual(verify().runId, next.runId);
});

test('多文件真实失败保留位置并在当前源码集中复验，未知与非法位置保守处理', t => {
  const { root, command, files } = repository(t);
  for (const name of ['a', 'b']) {
    files.push({ file: `tests/${name}.test.ts`, executor: 'node', scopes: ['all', 'tooling', 'rows'] });
    writeFileSync(join(root, `tests/${name}.test.ts`), `import {test} from 'node:test';test('${name} 的失败',()=>{throw Error('failure-${name}')});`);
  }
  writeFileSync(join(root, 'scripts/test-inventory.json'), JSON.stringify({ schemaVersion: 1, files }));
  assert.notEqual(command('scripts/check.mjs').status, 0);
  const manifestPath = join(root, 'logs/check-state/failures.json');
  const pending = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(pending.failures.map((item: any) => item.file).sort(), ['tests/a.test.ts', 'tests/b.test.ts']);
  assert.ok(pending.failures.every((item: any) => item.line > 0 && item.column > 0 && item.message));
  for (const name of ['a', 'b']) writeFileSync(join(root, `tests/${name}.test.ts`), `import {test} from 'node:test';test('${name} 的修复',()=>{});`);
  assert.equal(command('scripts/check.mjs', '--failed').status, 0);
  const retryPath = readdirSync(join(root, 'logs/recheck'), { recursive: true }).find(file => String(file).endsWith('test-failed-tests.json'));
  const retry = JSON.parse(readFileSync(join(root, 'logs/recheck', String(retryPath)), 'utf8'));
  assert.deepEqual(retry.expected.files, ['tests/a.test.ts', 'tests/b.test.ts']);
  for (const failure of [{ file: 'tests/missing.test.ts' }, { file: '../outside.test.ts' }, { name: '未知' , file: 'tests/missing.test.ts' }]) {
    writeFileSync(manifestPath, JSON.stringify({ failures: [failure] }));
    assert.notEqual(command('scripts/test-runner.mjs', '--suite', 'failed').status, 0);
  }
  writeFileSync(manifestPath, JSON.stringify({ failures: [{ name: '未知位置' }] }));
  assert.equal(command('scripts/test-runner.mjs', '--suite', 'failed').status, 0);
  assert.equal(JSON.parse(readFileSync(join(root, 'logs/report.json'), 'utf8')).actual.files.length, 3);
});

test('真实收集错误和迟到的未捕获异常不能被成功用例掩盖', t => {
  const { root, command } = repository(t);
  for (const source of [
    `import './missing.js';`,
    `import {test} from 'node:test';test('结束后错误',()=>{setTimeout(()=>{throw Error('late-uncaught')},20)});`,
  ]) {
    writeFileSync(join(root, 'tests/sample.test.ts'), source);
    assert.notEqual(command('scripts/test-runner.mjs').status, 0);
    const report = JSON.parse(readFileSync(join(root, 'logs/report.json'), 'utf8'));
    assert.equal(report.status, 'failed');
    assert.ok(report.failures.length || report.errors.length);
  }
});

test('默认完整检查拒绝同源码历史成功报告，执行身份绑定当次阶段与原生来源', t => {
  const { root, command } = repository(t);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  pkg.scripts.test = 'node replay.cjs';
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
  writeFileSync(join(root, 'replay.cjs'), `const fs=require('fs');fs.copyFileSync('logs/report.json',process.env.CLAPGRID_TEST_REPORT);`);
  assert.equal(command('scripts/test-runner.mjs').status, 0);
  const copied = command('scripts/check.mjs');
  assert.notEqual(copied.status, 0, '本次必须实际执行，不能复制相同源码历史成功');
});

test('清单允许的嵌套文件在修复后可以从真实失败待办集中复验', t => {
  const { root, command, files } = repository(t);
  mkdirSync(join(root, 'tests/nested'));
  files.push({ file: 'tests/nested/new.test.ts', executor: 'node', scopes: ['all', 'tooling', 'rows'] });
  writeFileSync(join(root, 'scripts/test-inventory.json'), JSON.stringify({ schemaVersion: 1, files }));
  writeFileSync(join(root, 'tests/nested/new.test.ts'), `import {test} from 'node:test';test('嵌套失败',()=>{throw Error('failed')});`);
  assert.notEqual(command('scripts/check.mjs').status, 0);
  writeFileSync(join(root, 'tests/nested/new.test.ts'), `import {test} from 'node:test';test('嵌套修复',()=>{});`);
  assert.equal(command('scripts/check.mjs', '--failed').status, 0);
});

test('显式原生 UI 对照失败可集中复验，常规完整范围仍排除对照', t => {
  const { root, command, files, env } = repository(t);
  symlinkSync(join(project, 'node_modules'), join(root, 'node_modules'), 'dir');
  env.CHROME_BIN = process.execPath; // 只验证命令调度；真实浏览器场景由原生试点覆盖。
  const nativeFile = 'tests/sample.native.ts';
  const source = `import {test} from 'node:test';import assert from 'node:assert/strict';import{existsSync}from'node:fs';test('原生对照',()=>assert.ok(existsSync('fixed')));`;
  writeFileSync(join(root, nativeFile), source);
  writeFileSync(join(root, 'scripts/test-inventory.json'), JSON.stringify({ schemaVersion: 1, files, references: [{ file: nativeFile, executor: 'node', scopes: ['comparison-only'], group: 'ui' }] }));
  writeFileSync(join(root, 'scripts/test-pilot-baseline.json'), JSON.stringify({ snapshots: [{ file: nativeFile, sha256: createHash('sha256').update(source).digest('hex') }] }));
  assert.notEqual(command('scripts/check-ui.mjs', '--scope', 'row', '--native').status, 0);
  const pending = JSON.parse(readFileSync(join(root, 'logs/check-state/failures.json'), 'utf8'));
  assert.equal(pending.failures[0].file, nativeFile);
  pending.failures.push({ name: '未知报告错误' });
  writeFileSync(join(root, 'logs/check-state/failures.json'), JSON.stringify(pending));
  assert.notEqual(command('scripts/check.mjs', '--failed').status, 0, '未知错误扩大范围时必须保留仍失败的原生对照');
  writeFileSync(join(root, 'fixed'), '修复被测行为');
  assert.equal(command('scripts/check.mjs', '--failed').status, 0);
  assert.equal(command('scripts/test-runner.mjs').status, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'logs/report.json'), 'utf8')).expected.files, ['tests/sample.test.ts']);
});

test('原生报告缺失仍保留对照范围，复验不能只运行普通全量后清空待办', t => {
  const { root, command, files, env } = repository(t);
  symlinkSync(join(project, 'node_modules'), join(root, 'node_modules'), 'dir');
  env.CHROME_BIN = process.execPath;
  const nativeFile = 'tests/sample.native.ts';
  const source = `import {test} from 'node:test';import assert from 'node:assert/strict';import{existsSync}from'node:fs';test('原生对照',()=>assert.ok(existsSync('fixed')));`;
  writeFileSync(join(root, nativeFile), source);
  writeFileSync(join(root, 'scripts/test-inventory.json'), JSON.stringify({ schemaVersion: 1, files, references: [{ file: nativeFile, executor: 'node', scopes: ['comparison-only'], group: 'ui' }] }));
  writeFileSync(join(root, 'scripts/test-pilot-baseline.json'), JSON.stringify({ snapshots: [{ file: nativeFile, sha256: createHash('sha256').update(source).digest('hex') }] }));
  writeFileSync(join(root, 'scripts/test-reporter.mjs'), 'export default async function* report(source){for await(const event of source){}}');
  assert.notEqual(command('scripts/check-ui.mjs', '--scope', 'row', '--native').status, 0);
  const manifest = JSON.parse(readFileSync(join(root, 'logs/check-state/failures.json'), 'utf8'));
  assert.deepEqual(manifest.referenceFiles, [nativeFile]);
  cpSync(join(project, 'scripts/test-reporter.mjs'), join(root, 'scripts/test-reporter.mjs'));
  assert.notEqual(command('scripts/check.mjs', '--failed').status, 0, '报告恢复后仍失败的原生场景必须实际复验');
  writeFileSync(join(root, 'fixed'), '修复被测行为');
  assert.equal(command('scripts/check.mjs', '--failed').status, 0);
});
