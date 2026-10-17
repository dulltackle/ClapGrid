import { createHash } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, symlinkSync, readdirSync, existsSync, statSync, utimesSync } from 'node:fs';
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
  // 留下 all-only 文件，故障必须进入真实剩余阶段，不能被预检覆盖。
  addRemaining(root);
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
  addRemaining(root);
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

function addRemaining(root: string) {
  const inventoryPath = join(root, 'scripts/test-inventory.json');
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
  inventory.files.push({ file: 'tests/remaining.test.ts', executor: 'node', scopes: ['all'] });
  writeFileSync(join(root, 'tests/remaining.test.ts'), `import {test} from 'node:test';test('剩余场景',()=>{});`);
  writeFileSync(inventoryPath, JSON.stringify(inventory));
}

test('同次真实预检按文件去重并累计完整证据，独立检查没有历史资格', t => {
  const { root, command } = repository(t);
  addRemaining(root);
  const inventory = JSON.parse(readFileSync(join(root, 'scripts/test-inventory.json'), 'utf8'));
  inventory.files.push({ file: 'tests/rows.test.ts', executor: 'node', scopes: ['all', 'rows'] });
  writeFileSync(join(root, 'scripts/test-inventory.json'), JSON.stringify(inventory));
  for (const [file, name] of [['sample', 'tooling'], ['rows', 'rows'], ['remaining', 'remaining']]) {
    writeFileSync(join(root, `tests/${file}.test.ts`), `import {test} from 'node:test';import {appendFileSync}from'node:fs';test('${name}',()=>appendFileSync('logs/observed.jsonl',JSON.stringify('${name}')+'\\n'));`);
  }
  const pkgPath = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.checkPreflight.push('test:rows');
  pkg.scripts['test:rows'] = 'node scripts/test-runner.mjs --suite rows';
  pkg.scripts.typecheck = `node -e "require('fs').appendFileSync('logs/observed.jsonl',JSON.stringify('typecheck')+'\\n')"`;
  writeFileSync(pkgPath, JSON.stringify(pkg));
  for (let round = 0; round < 2; round++) {
    const result = command('scripts/check.mjs');
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const observed = readFileSync(join(root, 'logs/observed.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    for (const name of ['typecheck', 'tooling', 'rows', 'remaining']) assert.equal(observed.filter(item => item === name).length, round + 1, `${name} 每个完整检查只实际执行一次`);
    const dirs = readdirSync(join(root, 'logs/check')).sort();
    const summary = JSON.parse(readFileSync(join(root, 'logs/check', dirs.at(-1)!, 'summary.json'), 'utf8'));
    assert.equal(summary.results[0].execution, 'counted');
    const report = JSON.parse(readFileSync(summary.results[1].testReport, 'utf8'));
    assert.equal(report.kind, 'test-cumulative');
    assert.equal(report.actual.cases.length, 3);
    assert.equal(new Set(report.actual.files.map((item: any) => item.file)).size, 3);
    assert.equal(report.runId, summary.runId);
    assert.match(result.stdout, /计入.*未再次执行/);
  }
});

test('预检覆盖全部文件时不启动空集合，完整报告明确引用原来源', t => {
  const { root, command } = repository(t);
  const result = command('scripts/check.mjs');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const dirs = readdirSync(join(root, 'logs/check')).sort();
  const summary = JSON.parse(readFileSync(join(root, 'logs/check', dirs.at(-1)!, 'summary.json'), 'utf8'));
  assert.equal(summary.results.find((step: any) => step.name === 'test').execution, 'counted');
  const report = JSON.parse(readFileSync(summary.results.find((step: any) => step.name === 'test').testReport, 'utf8'));
  assert.equal(report.kind, 'test-cumulative');
  assert.equal(report.sources.stages.length, 1);
});

test('正式复用逐项拒绝累计运行身份、来源、集合和阶段日志故障', t => {
  const { root, command } = repository(t);
  const verify = () => {
    const result = command('scripts/verify.mjs', '--revision', 'HEAD', '--reuse-passed');
    assert.equal(result.status, 0, result.stderr + result.stdout);
    return JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
  };
  let current = verify();
  const mutations = [
    (report: any) => { report.runId = 'other-run'; },
    (report: any) => { report.sources.stages.push(report.sources.stages[0]); },
    (report: any) => { report.sources.stages[0].files = []; },
    (report: any) => { report.actual.files = []; },
    (report: any) => { report.expected.cases = []; },
    (report: any) => { report.status = 'cancelled'; },
    (report: any) => { report.sources.stages[0].proof.sha256 = 'wrong'; },
    (report: any) => { const proof = JSON.parse(readFileSync(report.sources.stages[0].proof.path, 'utf8')); writeFileSync(proof.result.log, '改写原始日志'); },
  ];
  for (const mutate of mutations) {
    const summary = JSON.parse(readFileSync(current.checkSummary, 'utf8'));
    const path = summary.results.find((item: any) => item.name === 'test').testReport;
    const report = JSON.parse(readFileSync(path, 'utf8'));
    mutate(report); writeFileSync(path, JSON.stringify(report));
    const next = verify();
    assert.notEqual(next.runId, current.runId, '累计故障不能被 --reuse-passed 放行');
    current = next;
  }
});

for (const [faultStage, strict] of [['build',false],['typecheck',false],['build',true],['typecheck',true]] as const) test(`累计链 ${faultStage} 损坏原生复验来源后，未知待办仍保留${strict?'严格跳过':'失败'}原生范围并阻塞`, t => {
  const {root,command,files}=repository(t);
  const nativeFile='tests/reference.native.ts';
  const source=`import{test}from'node:test';import assert from'node:assert/strict';import{existsSync}from'node:fs';test('原生对照仍须复验',${strict?"{skip:existsSync('logs/native-fails')},":''}()=>assert.ok(!existsSync('logs/native-fails')));`;
  writeFileSync(join(root,nativeFile),source);
  writeFileSync(join(root,'scripts/test-inventory.json'),JSON.stringify({schemaVersion:1,files,references:[{file:nativeFile,executor:'node',scopes:['comparison-only'],group:'ui'}]}));
  writeFileSync(join(root,'scripts/test-pilot-baseline.json'),JSON.stringify({snapshots:[{file:nativeFile,sha256:createHash('sha256').update(source).digest('hex')}]}));
  mkdirSync(join(root,'logs/check-state'),{recursive:true});
  writeFileSync(join(root,'logs/check-state/failures.json'),JSON.stringify({stages:['test'],failures:[{name:'未知原报告错误'}],referenceFiles:[nativeFile],strictTestFiles:strict?[nativeFile]:[]}));
  writeFileSync(join(root,'break-native.cjs'),`const fs=require('fs'),path=require('path');const dir=fs.readdirSync('logs/check').sort().at(-1);const report=JSON.parse(fs.readFileSync(path.join('logs/check',dir,'recheck/test-failed-tests.json'),'utf8'));fs.rmSync(report.sources.native.path);fs.writeFileSync('logs/native-fails','原始证据失效后此行为也失败');`);
  const pkgPath=join(root,'package.json'),pkg=JSON.parse(readFileSync(pkgPath,'utf8'));pkg.scripts[faultStage]='node break-native.cjs';writeFileSync(pkgPath,JSON.stringify(pkg));
  const result=command('scripts/check.mjs');assert.notEqual(result.status,0,result.stdout+result.stderr);
  const manifest=JSON.parse(readFileSync(join(root,'logs/check-state/failures.json'),'utf8'));
  assert.deepEqual(manifest.referenceFiles,[nativeFile]);if(strict)assert.deepEqual(manifest.strictTestFiles,[nativeFile]);assert.ok(manifest.failures.some((item:any)=>!item.file),'累计链失效必须作为未知失败');
  const recheck=command('scripts/check.mjs','--failed');assert.notEqual(recheck.status,0,'仍失败的原生场景不能被普通all复验漏掉');
  assert.ok(recheck.stdout.includes('原生对照仍须复验'));assert.ok(readFileSync(join(root,'logs/check-state/failures.json'),'utf8').includes(nativeFile));
});

test('UI 严格政策随原生失败待办保留，跳过不能被普通复验清空', t => {
  const {root,command,files,env}=repository(t);
  symlinkSync(join(project,'node_modules'),join(root,'node_modules'),'dir');env.CHROME_BIN=process.execPath;
  const nativeFile='tests/strict.native.ts',source=`import{test}from'node:test';import{existsSync}from'node:fs';test('严格UI场景',{skip:!existsSync('logs/fixed')},()=>{});`;
  writeFileSync(join(root,nativeFile),source);
  writeFileSync(join(root,'scripts/test-inventory.json'),JSON.stringify({schemaVersion:1,files,references:[{file:nativeFile,executor:'node',scopes:['comparison-only'],group:'ui'}]}));
  writeFileSync(join(root,'scripts/test-pilot-baseline.json'),JSON.stringify({snapshots:[{file:nativeFile,sha256:createHash('sha256').update(source).digest('hex')}]}));
  const failed=command('scripts/check-ui.mjs','--scope','row','--native');assert.notEqual(failed.status,0);
  assert.notEqual(command('scripts/check.mjs','--failed').status,0,'UI缺执行不能通过非UI默认skip政策解除阻塞');
  const manifestPath=join(root,'logs/check-state/failures.json');
  assert.deepEqual(JSON.parse(readFileSync(manifestPath,'utf8')).strictTestFiles,[nativeFile]);
  writeFileSync(join(root,'logs/fixed'),'实际执行可用');
  assert.equal(command('scripts/check.mjs','--failed').status,0);assert.equal(existsSync(manifestPath),false);
});

test('普通严格 UI 来源在 main 类型阶段失效，后续仍须复验 UI 并阻塞', t => {
  const {root,command}=repository(t);
  writeFileSync(join(root,'tests/sample.test.ts'),`import{test}from'node:test';import{existsSync}from'node:fs';test('普通严格UI',{skip:existsSync('logs/unavailable')},()=>{});`);
  mkdirSync(join(root,'logs/check-state'),{recursive:true});
  writeFileSync(join(root,'logs/check-state/failures.json'),JSON.stringify({stages:['test'],failures:[{name:'原UI未知错误'}],strictTestFiles:['tests/sample.test.ts']}));
  writeFileSync(join(root,'erase.cjs'),`const fs=require('fs'),path=require('path');const dir=fs.readdirSync('logs/check').sort().at(-1);const report=JSON.parse(fs.readFileSync(path.join('logs/check',dir,'recheck/test-failed-tests.json'),'utf8'));fs.rmSync(report.sources.native.path);fs.writeFileSync('logs/unavailable','UI尚未实际执行');`);
  const pkgPath=join(root,'package.json'),pkg=JSON.parse(readFileSync(pkgPath,'utf8'));pkg.checkPreflight=['typecheck','erase'];pkg.scripts.erase='node erase.cjs';writeFileSync(pkgPath,JSON.stringify(pkg));
  const result=command('scripts/check.mjs');assert.notEqual(result.status,0,result.stdout+result.stderr);
  const manifestPath=join(root,'logs/check-state/failures.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  assert.deepEqual(manifest.strictTestFiles,['tests/sample.test.ts']);assert.ok(manifest.stages.includes('test'),'严格范围必须产生测试待办阶段');
  const recheck=command('scripts/check.mjs','--failed');assert.notEqual(recheck.status,0,'只复验typecheck不能解除严格UI阻塞');assert.ok(recheck.stdout.includes('普通严格UI'));
  rmSync(join(root,'logs/unavailable'));writeFileSync(join(root,'erase.cjs'),'// 修复实际故障注入阶段，不能靠删除待办放行\n');assert.equal(command('scripts/check.mjs','--failed').status,0);assert.equal(existsSync(manifestPath),false);
});

test('完整 all/rows 的业务 UI 文件保持严格，非 UI skip 政策仍按文件保留', t => {
  const {root,command}=repository(t);addRemaining(root);
  const path=join(root,'scripts/test-inventory.json'),inventory=JSON.parse(readFileSync(path,'utf8'));
  inventory.files.find((item:any)=>item.file==='tests/sample.test.ts').policy='ui';writeFileSync(path,JSON.stringify(inventory));
  writeFileSync(join(root,'tests/sample.test.ts'),`import{test}from'node:test';test.skip('业务UI必须实际执行',()=>{});`);
  writeFileSync(join(root,'tests/remaining.test.ts'),`import{test}from'node:test';test.skip('普通非UI沿用skip政策',()=>{});`);
  for(const policy of ['skip','todo']) {
    writeFileSync(join(root,'tests/sample.test.ts'),`import{test}from'node:test';test.${policy}('业务UI必须实际执行',()=>{});`);
    for(const suite of ['all','rows'])assert.notEqual(command('scripts/test-runner.mjs','--suite',suite).status,0,`${suite} UI ${policy}不能假绿`);
  }
  assert.notEqual(command('scripts/check.mjs').status,0,'完整预检也必须拒绝UI skip');
  const manifestPath=join(root,'logs/check-state/failures.json');assert.deepEqual(JSON.parse(readFileSync(manifestPath,'utf8')).strictTestFiles,['tests/sample.test.ts']);
  assert.notEqual(command('scripts/check.mjs','--failed').status,0);
  writeFileSync(join(root,'tests/sample.test.ts'),`import{test}from'node:test';test('业务UI实际执行',()=>{});`);
  assert.equal(command('scripts/check.mjs').status,0,'真实UI恢复后普通非UI skip仍合法');
  const dirs=readdirSync(join(root,'logs/check')).sort(),summary=JSON.parse(readFileSync(join(root,'logs/check',dirs.at(-1)!,'summary.json'),'utf8'));
  const cumulative=JSON.parse(readFileSync(summary.results.find((item:any)=>item.name==='test').testReport,'utf8'));
  assert.equal(cumulative.actual.cases.find((item:any)=>item.name==='业务UI实际执行').status,'passed');
  assert.equal(cumulative.actual.cases.find((item:any)=>item.name==='普通非UI沿用skip政策').status,'skipped');
});

test('新宿主校验旧执行器原 plan，已通过的旧业务 UI 可验而 skip/todo 仍拒绝', t => {
  const {root,command}=repository(t);
  rmSync(join(root,'scripts/node-compile-cache.mjs'));
  for(const file of ['test-evidence.mjs','check-runner.mjs','test-runner.mjs'])writeFileSync(join(root,'scripts',file),readFileSync(new URL(`./fixtures/legacy-a0558ff/${file}`,import.meta.url)));
  rmSync(join(root,'tests/sample.test.ts'));
  const ui='tests/drag-scroll-panel.test.ts',ordinary='tests/ordinary.test.ts';
  writeFileSync(join(root,'scripts/test-inventory.json'),JSON.stringify({schemaVersion:1,files:[{file:ui,executor:'node',scopes:['all','tooling','rows']},{file:ordinary,executor:'node',scopes:['all','tooling','rows']}]}));
  writeFileSync(join(root,ordinary),`import{test}from'node:test';test.skip('普通OS skip合法',()=>{});`);
  const host=new URL('scripts/test-evidence.mjs',new URL('../',import.meta.url)).href;
  for(const state of ['pass','skip','todo']){
    writeFileSync(join(root,ui),`import{test}from'node:test';test${state==='pass'?'':'.'+state}('旧业务UI',()=>{});`);
    const old=command('scripts/check.mjs');assert.equal(old.status,0,old.stdout+old.stderr);
    const dirs=readdirSync(join(root,'logs/check')).sort(),path=join(root,'logs/check',dirs.at(-1)!,'summary.json');
    const validate=command('--input-type=module','-e',`import{readFileSync}from'node:fs';import{validateCheckEvidence}from ${JSON.stringify(host)};const check=JSON.parse(readFileSync(${JSON.stringify(path)},'utf8'));validateCheckEvidence(${JSON.stringify(root)},check,check.source);`);
    if(state==='pass')assert.equal(validate.status,0,validate.stderr+validate.stdout);else assert.notEqual(validate.status,0,`旧${state}也不能被新宿主放行`);
  }
});

function legacyRepository(t: TestContext, revision: string, framework: string) {
  const fixture=repository(t),{root}=fixture;
  // 冻结旧生产者源码，兼容回归不依赖 CI 提供历史 Git objects。
  for(const file of ['check-runner.mjs','test-runner.mjs'])cpSync(new URL(`./fixtures/legacy-d1e740a/${file}`,import.meta.url),join(root,'scripts',file));
  cpSync(new URL(`./fixtures/legacy-${revision}/test-evidence.mjs`,import.meta.url),join(root,'scripts/test-evidence.mjs'));
  rmSync(join(root,'scripts/check-evidence.mjs'));
  rmSync(join(root,'scripts/node-compile-cache.mjs'));
  if(framework==='node')rmSync(join(root,'scripts/vitest-runner.mjs'));
  if(framework!=='playwright')rmSync(join(root,'scripts/playwright-runner.mjs'));
  return fixture;
}

for (const [revision, framework] of [['d1e740a', 'node'], ['18c9678', 'vitest'], ['ad5573a', 'playwright']] as const) test(`新宿主兼容累计账本之前的 ${framework} 配置身份并拒绝旧原始证据损坏`, t => {
  const {root,command}=legacyRepository(t,revision,framework);
  const old=command('scripts/check.mjs');assert.equal(old.status,0,old.stdout+old.stderr);
  const dirs=readdirSync(join(root,'logs/check')).sort(),path=join(root,'logs/check',dirs.at(-1)!,'summary.json');
  const check=JSON.parse(readFileSync(path,'utf8'));assert.equal(check.runId,undefined);
  const host=new URL('../scripts/test-evidence.mjs',import.meta.url).href;
  const validate=()=>command('--input-type=module','-e',`import{readFileSync}from'node:fs';import{validateCheckEvidence}from ${JSON.stringify(host)};const check=JSON.parse(readFileSync(${JSON.stringify(path)},'utf8'));validateCheckEvidence(${JSON.stringify(root)},check,check.source);`);
  const passed=validate();assert.equal(passed.status,0,passed.stdout+passed.stderr);
  for(const mutate of [
    (value:any)=>{value.results.pop();},
    (value:any)=>{value.results.find((item:any)=>item.name==='test').testExecutionId='other-run';},
    (value:any)=>{value.results.find((item:any)=>item.name==='test').execution='counted';},
  ]){
    const changed=structuredClone(check);mutate(changed);writeFileSync(path,JSON.stringify(changed));assert.notEqual(validate().status,0,'旧协议仍核对全部阶段、nonce及真实执行');
  }
  writeFileSync(path,JSON.stringify(check));
  const report=JSON.parse(readFileSync(check.results.find((item:any)=>item.name==='test').testReport,'utf8'));
  writeFileSync(report.sources.native.path,readFileSync(report.sources.native.path,'utf8')+' ');
  assert.notEqual(validate().status,0,'兼容旧协议仍须校验原 raw 摘要');
});

test('旧版完整检查的真实验收与显式复用保持可用，损坏 raw 必须新验收', async t=>{
  const {root,git}=legacyRepository(t,'d1e740a','node');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','legacy-producer');
  const {verify}=await import(new URL('../scripts/verify.mjs',import.meta.url).href);
  const first=await verify(root,'HEAD',undefined,{reusePassed:true});assert.equal(first.status,'passed',JSON.stringify(first));
  const same=await verify(root,'HEAD',undefined,{reusePassed:true});assert.equal(same.runId,first.runId);assert.equal(same.reused,true);assert.equal(same.completedAt,first.completedAt);
  const check=JSON.parse(readFileSync(first.checkSummary,'utf8')),report=JSON.parse(readFileSync(check.results.find((item:any)=>item.name==='test').testReport,'utf8'));
  writeFileSync(report.sources.native.path,readFileSync(report.sources.native.path,'utf8')+' ');
  const fresh=await verify(root,'HEAD',undefined,{reusePassed:true});assert.equal(fresh.status,'passed');assert.notEqual(fresh.runId,first.runId);assert.notEqual(fresh.reused,true);
});

test('新目标不能删除累计证明后降级旧协议，旧 UI skip 也不能放行',t=>{
  const current=repository(t);assert.equal(current.command('scripts/check.mjs').status,0);
  const host=new URL('../scripts/test-evidence.mjs',import.meta.url).href;
  const validate=(root:string,path:string)=>spawnSync(process.execPath,['--input-type=module','-e',`import{readFileSync}from'node:fs';import{validateCheckEvidence}from ${JSON.stringify(host)};const check=JSON.parse(readFileSync(${JSON.stringify(path)},'utf8'));validateCheckEvidence(${JSON.stringify(root)},check,check.source);`],{cwd:root,env:current.env,encoding:'utf8'});
  const dirs=readdirSync(join(current.root,'logs/check')).sort(),path=join(current.root,'logs/check',dirs.at(-1)!,'summary.json'),check=JSON.parse(readFileSync(path,'utf8'));
  delete check.runId;delete check.proofs;writeFileSync(path,JSON.stringify(check));assert.notEqual(validate(current.root,path).status,0);
  const old=legacyRepository(t,'d1e740a','node'),file='tests/drag-scroll-panel.test.ts';rmSync(join(old.root,'tests/sample.test.ts'));
  writeFileSync(join(old.root,'scripts/test-inventory.json'),JSON.stringify({schemaVersion:1,files:[{file,executor:'node',scopes:['all','tooling','rows']}]}));
  writeFileSync(join(old.root,file),`import{test}from'node:test';test.skip('旧UI没有实际执行',()=>{});`);
  assert.equal(old.command('scripts/check.mjs').status,0,'旧生产者确实允许该skip，拒绝来自新宿主政策');
  const oldDirs=readdirSync(join(old.root,'logs/check')).sort();assert.notEqual(validate(old.root,join(old.root,'logs/check',oldDirs.at(-1)!,'summary.json')).status,0);
});

test('实际结束身份校验返回新采集身份，拒绝旧报告掩盖源码或原始来源变化', t => {
  const {root,command}=repository(t);
  mkdirSync(join(root,'src'));const input=join(root,'src/guard-input.bin');writeFileSync(input,Buffer.from([41]));
  const actual=command('scripts/test-runner.mjs');assert.equal(actual.status,0,actual.stdout+actual.stderr);
  const reportPath=join(root,'logs/report.json'),report=JSON.parse(readFileSync(reportPath,'utf8'));
  const expectedPath=join(root,'logs/parent-expected.json');writeFileSync(expectedPath,JSON.stringify(report.identity));
  const host=new URL('../scripts/test-evidence.mjs',import.meta.url).href;
  const validate=()=>command('--input-type=module','--eval',`import{readFileSync}from'node:fs';import{validateExecutionSourceAsync}from${JSON.stringify(host)};const report=JSON.parse(readFileSync(${JSON.stringify(reportPath)},'utf8'));const expected=JSON.parse(readFileSync(${JSON.stringify(expectedPath)},'utf8'));console.log(JSON.stringify(await validateExecutionSourceAsync(${JSON.stringify(root)},report,report.plan,expected)));`);
  const valid=validate();assert.equal(valid.status,0,valid.stdout+valid.stderr);assert.deepEqual(JSON.parse(valid.stdout),report.identity);
  const raw=readFileSync(report.sources.native.path);writeFileSync(report.sources.native.path,Buffer.concat([raw,Buffer.from(' ')]));
  assert.notEqual(validate().status,0,'真实原始证据损坏仍被完整校验拒绝');writeFileSync(report.sources.native.path,raw);
  const stat=statSync(input);writeFileSync(input,Buffer.from([99]));utimesSync(input,stat.atime,stat.mtime);
  const changed=validate();assert.notEqual(changed.status,0,'不能沿用磁盘报告自报的结束身份');assert.match(changed.stderr,/源码/);
});
