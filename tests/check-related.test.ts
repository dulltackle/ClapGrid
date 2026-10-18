import assert from 'node:assert/strict';
import { test, vi, type TestContext } from 'vitest';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { dependencyView, temporaryRepository } from './helpers/temporary-repository.js';

// 原 Node 未显式设置测试/收尾时限；保留各真实命令及业务等待上限。
vi.setConfig({ testTimeout: 0, hookTimeout: 0 });

const project = fileURLToPath(new URL('../', import.meta.url));
function repository(t: TestContext) {
  const { root, put, git, own, environment } = temporaryRepository(cleanup => t.onTestFinished(cleanup), { project, prefix: 'clapgrid-related-' });
  put('.gitignore', 'logs/\nnode_modules\n');
  put('package.json', JSON.stringify({ name: 'related-fixture', private: true, type: 'module', scripts: { 'check:related': 'node scripts/check-related.mjs', check: 'node scripts/check.mjs', 'test:failed': 'node scripts/test-runner.mjs --suite failed', typecheck: 'node task.mjs', build: 'node task.mjs' }, devDependencies: { tsx: '4.23.15', vitest: '5.0.5', '@playwright/test': '1.64.1' } }));
  put('task.mjs', 'console.log("fixture non-test stage");');
  put('vitest.config.ts', 'export default {test:{include:["tests/text-search.test.ts"],pool:"threads",maxWorkers:1,fileParallelism:false,isolate:true,retry:0,allowOnly:false,includeTaskLocation:true}};');
  put('playwright.config.ts', readFileSync(join(project, 'playwright.config.ts'), 'utf8'));
  put('src/number.ts', 'export const value = 7;\n');
  put('src/other.ts', 'export const other = 2;\n');
  put('tests/number.test.ts', 'import {test} from "node:test";import assert from "node:assert/strict";import {value} from "../src/number.js";test("number fixture",()=>assert.equal(value,7));\n');
  put('tests/text-search.test.ts', 'import {test,expect} from "vitest";test("vitest fixture",()=>expect(2+2).toBe(4));\n');
  put('tests/style-collisions.test.ts', 'import {test,expect} from "@playwright/test";test("playwright fixture",()=>expect(3+4).toBe(7));\n');
  const inventory = { schemaVersion: 1, files: [
    { file: 'tests/number.test.ts', executor: 'node', scopes: ['all'] },
    { file: 'tests/text-search.test.ts', executor: 'vitest', scopes: ['all'] },
    { file: 'tests/style-collisions.test.ts', executor: 'playwright', scopes: ['all', 'ui-core'] },
  ] };
  put('scripts/test-inventory.json', JSON.stringify(inventory));
  const commit = () => { git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  const base = commit();
  const cli = (...args: string[]) => spawnSync(process.execPath, ['scripts/check-related.mjs', ...args], { cwd: root, encoding: 'utf8', env: environment(), timeout: 30000 });
  const plan = (...args: string[]) => { const result = cli('--plan', ...args); assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); };
  const summary = () => { const directory = join(root, 'logs/check-related'); const dirs = readdirSync(directory).sort(); return JSON.parse(readFileSync(join(directory, dirs.at(-1)!, 'summary.json'), 'utf8')); };
  return { root, put, git, commit, base, cli, plan, inventory, summary, own };
}

test('日常计划按实际归属选择修改的测试，列明基准、未覆盖与局部结论', t => {
  const r = repository(t);
  r.put('tests/text-search.test.ts', readFileSync(join(r.root, 'tests/text-search.test.ts'), 'utf8') + '// test edit\n');
  const plan = r.plan();
  assert.equal(plan.base.requested, 'HEAD'); assert.equal(plan.base.commit, r.base);
  assert.deepEqual(plan.changes.map((item: any) => item.path), ['tests/text-search.test.ts']);
  assert.deepEqual(plan.selected, ['tests/text-search.test.ts']);
  assert.deepEqual(plan.executors, [{ executor: 'vitest', files: ['tests/text-search.test.ts'] }]);
  assert.deepEqual(plan.notCovered, ['tests/number.test.ts', 'tests/style-collisions.test.ts']);
  assert.ok(plan.reasons.some((reason: any) => reason.rule === 'changed-test'));
  assert.equal(plan.completeForFullCheck, false); assert.equal(plan.requiredFollowup, 'full-check-and-verify');
});

test('历史材料变化明确列为排除，不进入当前和基准依赖图；未知资源仍扩大检查', t => {
  const r = repository(t);
  r.put('docs/productions/old.ts', 'this is not valid typescript {'); r.commit();
  r.put('docs/productions/old.ts', 'another invalid archived source {');
  const excluded = r.plan();
  assert.deepEqual(excluded.selected, []);
  assert.equal(excluded.status, 'no-changes');
  assert.deepEqual(excluded.excludedChanges.map((item: any) => item.path), ['docs/productions/old.ts']);
  r.put('src/number.ts', 'export const value = 8;');
  const plan = r.plan();
  assert.deepEqual(plan.selected, ['tests/number.test.ts']);
  r.put('new-resources/font.bin', 'fresh unknown input');
  assert.equal(r.plan().selected.length, r.inventory.files.length);
});

test('逻辑源码通过 .js 扩展、export-from 与字面量动态导入选择消费者，不强制跑其他逻辑组', t => {
  const r = repository(t);
  r.put('src/barrel.ts', 'export {value} from "./number.js";\n');
  r.put('tests/number.test.ts', 'import {test} from "node:test";test("dynamic consumer",async()=>{const {value}=await import("../src/barrel.js");if(value!==7)throw Error("value");});\n');
  r.commit(); r.put('src/number.ts', 'export const value = 7; // leaf edit\n');
  const plan = r.plan();
  assert.deepEqual(plan.selected, ['tests/number.test.ts']);
  assert.ok(plan.reasons.some((reason: any) => reason.rule === 'static-dependents' && reason.path === 'src/number.ts'));
});

test('非样式UI源码结合 alias 消费者、固定核心及组件映射，保留类型和构建要求', t => {
  const r = repository(t);
  r.put('src/panel/editing.ts', 'export const value = 7;\n');
  r.put('tests/number.test.ts', 'import {test} from "node:test";import {value} from "@/editing.js";test("alias",()=>{if(value!==7)throw Error("value")});\n');
  r.put('tests/editing-panel.test.ts', 'import{test}from"node:test";test("string browser script",()=>{});\n');
  r.inventory.files.push({ file: 'tests/editing-panel.test.ts', executor: 'node', scopes: ['all'] });
  r.put('scripts/test-inventory.json', JSON.stringify(r.inventory)); r.commit();
  r.put('src/panel/editing.ts', 'export const value = 8;\n');
  const plan = r.plan();
  assert.deepEqual(plan.selected, ['tests/editing-panel.test.ts', 'tests/number.test.ts', 'tests/style-collisions.test.ts']);
  assert.ok(plan.reasons.some((reason: any) => reason.rule === 'non-style-ui'));
  assert.equal(plan.requiresBuild, true); assert.equal(plan.completeForLocalUi, false);
});

test('配置、helper、生产模板和无法解释的文件读取保守扩大，静态CSS与扫描规则区别呈现', t => {
  const r = repository(t);
  r.put('src/panel/style.css', '@import "tailwindcss";\n.x { color:red; }\n');
  r.put('docs/templates/video.md', 'runtime template\n');
  r.put('src/number.ts', 'import {readFileSync} from "node:fs";export const value = 7;\n');
  r.commit();
  const expected = ['tests/number.test.ts', 'tests/style-collisions.test.ts', 'tests/text-search.test.ts'];
  for (const [file, contents, rule] of [
    ['docs/templates/video.md', 'changed template\n', 'implicit-input'],
    ['tests/helpers/new-helper.ts', 'export const helper=1;\n', 'shared-helper'],
    ['vitest.config.ts', 'export default {};\n', 'configuration-or-build'],
    ['src/number.ts', 'import {readFileSync} from "node:fs";export const value = 8;\n', 'opaque-input'],
    ['src/panel/style.css', '@import "tailwindcss";\n@source "../shared";\n.x {color:red;}\n', 'css-input-rules'],
  ] as const) {
    r.put(file, contents); const plan = r.plan();
    assert.deepEqual(plan.selected, expected, file);
    assert.ok(plan.reasons.some((reason: any) => reason.rule === rule), `${file}: ${JSON.stringify(plan.reasons)}`);
    r.git('checkout', '--', '.'); if (file === 'tests/helpers/new-helper.ts') rmSync(join(r.root, file));
  }
  r.put('src/panel/style.css', '@import "tailwindcss";\n.x { color:blue; }\n');
  const style = r.plan(); assert.deepEqual(style.selected, ['tests/style-collisions.test.ts']);
  assert.equal(style.completeForLocalUi, true); assert.equal(style.requiresBuild, true);
});

test('基准依赖与工作区依赖取并集；新增、删除、遗漏及重复归属不能被局部选测掩盖', t => {
  const r = repository(t);
  r.put('tests/number.test.ts', 'import{test}from"node:test";import{other}from"../src/other.js";test("other",()=>{});\n');
  rmSync(join(r.root, 'src/number.ts'));
  const plan = r.plan(); assert.deepEqual(plan.selected, ['tests/number.test.ts']);
  assert.equal(plan.changes.find((change: any) => change.path === 'src/number.ts').kind, 'deleted');
  r.git('checkout', '--', '.');
  r.put('tests/new.test.ts', 'import{test}from"node:test";test("new",()=>{});');
  let result = r.cli('--plan'); assert.equal(result.status, 1); assert.match(result.stderr, /未登记.*tests\/new.test.ts/);
  r.inventory.files.push({ file: 'tests/new.test.ts', executor: 'node', scopes: ['all'] });
  r.put('scripts/test-inventory.json', JSON.stringify(r.inventory));
  assert.equal(r.plan().selected.length, 4);
  r.inventory.files.push(r.inventory.files[0]!); r.put('scripts/test-inventory.json', JSON.stringify(r.inventory));
  result = r.cli('--plan'); assert.equal(result.status, 1); assert.match(result.stderr, /重复归属/);
  r.git('checkout', '--', '.'); rmSync(join(r.root, 'tests/new.test.ts'));
  rmSync(join(r.root, 'tests/number.test.ts'));
  result = r.cli('--plan'); assert.equal(result.status, 1); assert.match(result.stderr, /已丢失.*number/);
  r.inventory.files = r.inventory.files.filter((entry, index) => entry.file !== 'tests/number.test.ts' && index < 3);
  r.put('scripts/test-inventory.json', JSON.stringify(r.inventory));
  assert.ok(r.plan().reasons.some((reason: any) => reason.rule === 'test-removal'));
});


test('默认真实日常命令单次退出，保留逐项报告和未覆盖；无改动及文档-only不产生通过证据', t => {
  const r = repository(t);
  let result = r.cli(); assert.equal(result.status, 2, result.stderr);
  let summary = r.summary(); assert.equal(summary.status, 'no-changes'); assert.deepEqual(summary.actual.files, []); assert.equal(summary.relatedFeedback, 'not-run');
  r.put('docs/agents/notes.md', '协作说明\n');
  result = r.cli(); assert.equal(result.status, 2, result.stderr);
  summary = r.summary(); assert.equal(summary.status, 'no-tests-selected'); assert.equal(summary.completeForLocalUi, false);
  r.put('tests/number.test.ts', readFileSync(join(r.root, 'tests/number.test.ts'), 'utf8') + '// edit\n');
  result = r.cli(); assert.equal(result.status, 0, result.stderr);
  summary = r.summary(); assert.equal(summary.status, 'passed'); assert.equal(summary.relatedFeedback, 'passed');
  assert.deepEqual(summary.expected.files, ['tests/number.test.ts']);
  assert.deepEqual(summary.actual.files.map((file: any) => file.file), ['tests/number.test.ts']);
  assert.equal(summary.actual.cases.length, 1); assert.equal(summary.completeForFullCheck, false); assert.equal(summary.completeForFormalVerification, false);
  assert.equal(summary.source.fingerprint, summary.sourceAfter.fingerprint); assert.ok(summary.totalMs > 0);
  assert.equal(existsSync(join(r.root, 'logs/check-state/active')), false);
});


test('扩大范围真实分派Node、Vitest和Playwright，原报告和逐项并集等于唯一清单', t => {
  const r = repository(t), result = r.cli('--all');
  assert.equal(result.status, 0, result.stderr); const summary = r.summary();
  assert.equal(summary.status, 'passed'); assert.equal(summary.actual.cases.length, 3);
  assert.deepEqual(summary.actual.files.map((item: any) => item.file).sort(), ['tests/number.test.ts', 'tests/style-collisions.test.ts', 'tests/text-search.test.ts']);
  const report = JSON.parse(readFileSync(summary.results.find((stage: any) => stage.name === 'test').testReport, 'utf8'));
  assert.equal(report.kind, 'test-aggregate'); assert.deepEqual(report.executions.map((item: any) => item.executor.name).sort(), ['node', 'playwright', 'vitest']);
  assert.ok(report.executions.every((item: any) => existsSync(item.sources.native.path)));
  assert.deepEqual(summary.results.map((item: any) => item.name), ['typecheck', 'test', 'build']);
  assert.equal(summary.completeForFormalVerification, false); assert.ok(summary.totalMs > 0);
});

test('零用例及退出零但缺报告都失败并进入未知失败集中待办，不能当作改动通过', t => {
  for (const fault of ['zero', 'missing-report']) {
    const r = repository(t);
    if (fault === 'zero') r.put('tests/number.test.ts', 'export const noTests = true;\n');
    else r.put('scripts/test-runner.mjs', 'console.log("退出零但缺失报告");\n');
    const result = r.cli(); assert.equal(result.status, 1, fault);
    const summary = r.summary(); assert.equal(summary.status, 'failed'); assert.equal(summary.relatedFeedback, 'failed');
    const pending = JSON.parse(readFileSync(join(r.root, 'logs/check-state/failures.json'), 'utf8'));
    assert.deepEqual(pending.stages, ['test']); assert.ok(pending.failures.length > 0);
    assert.equal(summary.results.at(-1).name, 'test'); assert.equal(summary.results.at(-1).status, 'failed');
  }
});

test('已知跨执行者失败先在当前源码集中复验，解除待办仍只提供相关反馈', t => {
  const r = repository(t), original = readFileSync(join(r.root, 'tests/text-search.test.ts'), 'utf8');
  r.put('tests/text-search.test.ts', 'import{test}from"vitest";test("owner failure",()=>{throw Error("known failure")});');
  assert.equal(r.cli().status, 1);
  let pending = JSON.parse(readFileSync(join(r.root, 'logs/check-state/failures.json'), 'utf8'));
  assert.ok(pending.failures.some((item: any) => item.file === 'tests/text-search.test.ts' && item.name === 'owner failure'));
  r.put('tests/text-search.test.ts', original);
  r.put('tests/number.test.ts', readFileSync(join(r.root, 'tests/number.test.ts'), 'utf8') + '// unrelated edit\n');
  const result = r.cli(); assert.equal(result.status, 0, result.stderr);
  const summary = r.summary(); assert.equal(summary.recheck.status, 'passed');
  const recheck = summary.recheck.results.find((item: any) => item.name === 'test:failed');
  assert.deepEqual(recheck.testPlan.files, ['tests/text-search.test.ts']);
  assert.deepEqual(summary.expected.files, ['tests/number.test.ts']);
  assert.equal(existsSync(join(r.root, 'logs/check-state/failures.json')), false);
  assert.equal(summary.completeForFullCheck, false);
});


test('源码期间变化使日常结果invalidated并停止后续阶段', t => {
  const r = repository(t);
  r.put('task.mjs', 'import{writeFileSync}from"node:fs";writeFileSync("src/number.ts","export const value=9;\\n");');
  const result = r.cli(); assert.equal(result.status, 1, result.stderr);
  const summary = r.summary(); assert.equal(summary.status, 'invalidated');
  assert.notEqual(summary.source.fingerprint, summary.sourceAfter.fingerprint);
  assert.deepEqual(summary.results.map((stage: any) => stage.name), ['typecheck']);
  assert.equal(summary.relatedFeedback, 'not-run'); assert.equal(existsSync(join(r.root, 'logs/check-state/active')), false);
});

async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 10000;
  while (!predicate() && Date.now() < deadline) await delay(20);
  assert.ok(predicate(), message);
}

test('真实日常命令与完整检查互斥；显式取消清理孙进程而不影响另一工作树', { skip: process.platform === 'win32' }, async t => {
  const r = repository(t);
  r.put('tests/number.test.ts', `import{test}from"node:test";import{spawn}from"node:child_process";test("running",async()=>{spawn(process.execPath,['-e','setInterval(()=>require("node:fs").appendFileSync("logs/heartbeat","x"),20)'],{stdio:'ignore'});await new Promise(()=>{});});`);
  const child = spawn(process.execPath, ['scripts/check-related.mjs'], { cwd: r.root, env: { ...process.env, NODE_TEST_CONTEXT: undefined }, stdio: 'ignore' });
  const closed = r.own(child);
  t.onTestFinished(() => { try { child.kill('SIGTERM'); } catch {} });
  await until(() => existsSync(join(r.root, 'logs/heartbeat')), '真实孙进程应开始写心跳');
  try {
    assert.equal(r.cli().status, 1);
    const full = spawnSync(process.execPath, ['scripts/check.mjs'], { cwd: r.root, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined }, timeout: 5000 });
    assert.equal(full.status, 1); assert.match(full.stderr, /已有检查/);
    const other = mkdtempSync(join(tmpdir(), 'clapgrid-related-worktree-')); t.onTestFinished(() => rmSync(other, { recursive: true, force: true }));
    r.git('worktree', 'add', '--quiet', '--detach', other, r.base);
    dependencyView(other, join(project, 'node_modules'));
    writeFileSync(join(other, 'tests/number.test.ts'), readFileSync(join(other, 'tests/number.test.ts'), 'utf8') + '// independent edit\n');
    const independent = spawnSync(process.execPath, ['scripts/check-related.mjs'], { cwd: other, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined }, timeout: 15000 });
    assert.equal(independent.status, 0, independent.stderr);
    const stop = spawnSync(process.execPath, ['scripts/check-lifecycle.mjs'], { cwd: r.root, encoding: 'utf8', timeout: 10000 });
    assert.equal(stop.status, 0, stop.stderr);
    assert.equal(await closed, 130);
    const heartbeat = readFileSync(join(r.root, 'logs/heartbeat'), 'utf8'); await delay(120);
    assert.equal(readFileSync(join(r.root, 'logs/heartbeat'), 'utf8'), heartbeat);
    assert.equal(r.summary().status, 'cancelled'); assert.equal(existsSync(join(r.root, 'logs/check-state/active')), false);
    assert.equal(existsSync(join(other, 'logs/check-state/active')), false);
  } finally { if (child.exitCode === null) { child.kill('SIGTERM'); await closed; } }
});

test('面板静态消费者之外的字符串浏览器脚本也随逻辑依赖进入范围；陌生输入保守扩大', t => {
  const r = repository(t);
  r.put('src/panel/app.tsx', 'import{value}from"../number.js";export const App=()=>value;\n');
  r.put('tests/string-panel.test.ts', 'import{test}from"node:test";const script=String.raw`import App from "./src/panel/app.tsx"`;test("script",()=>{});');
  r.inventory.files.push({ file: 'tests/string-panel.test.ts', executor: 'node', scopes: ['all'] });
  r.put('scripts/test-inventory.json', JSON.stringify(r.inventory)); r.commit();
  r.put('src/number.ts', 'export const value = 8;\n');
  const plan = r.plan(); assert.deepEqual(plan.selected, ['tests/number.test.ts', 'tests/string-panel.test.ts', 'tests/style-collisions.test.ts']);
  assert.ok(plan.reasons.some((reason: any) => reason.rule === 'panel-consumers'));
  r.git('checkout', '--', '.'); r.put('new-runtime-input.dat', 'unknown\n');
  const expanded = r.plan(); assert.equal(expanded.selected.length, 4); assert.equal(expanded.notCovered.length, 0);
  assert.ok(expanded.reasons.some((reason: any) => reason.rule === 'conservative-all'));
});

test('旧身份、实际集合缺口和原始来源损坏不能使退出零的执行得到通过', t => {
  for (const mutation of ['report.identity.executionId="old-run";', 'report.actual.files.pop();', 'fs.appendFileSync(report.sources.executions[0].path," ");']) {
    const r = repository(t);
    cpSync(join(r.root, 'scripts/test-runner.mjs'), join(r.root, 'scripts/real-runner.mjs'));
    r.put('scripts/test-runner.mjs', `import{spawnSync}from'node:child_process';import*as fs from'node:fs';const run=spawnSync(process.execPath,['scripts/real-runner.mjs',...process.argv.slice(2)],{stdio:'inherit',env:process.env});if(run.status!==0)process.exit(run.status??1);const file=process.env.CLAPGRID_TEST_REPORT;const report=JSON.parse(fs.readFileSync(file,'utf8'));${mutation}fs.writeFileSync(file,JSON.stringify(report));`);
    const result = r.cli(); assert.equal(result.status, 1, result.stderr);
    const summary = r.summary(); assert.equal(summary.status, 'failed'); assert.equal(summary.relatedFeedback, 'failed');
    assert.ok(summary.results.find((stage: any) => stage.name === 'test').error.includes('证据无效'));
    assert.equal(existsSync(join(r.root, 'logs/check-state/failures.json')), true);
  }
});

test('普通Node跳过明确呈现，UI跳过仍拒绝且保留实际归属待办', t => {
  const r = repository(t);
  r.put('tests/number.test.ts', 'import{test}from"node:test";test.skip("optional environment",()=>{});');
  assert.equal(r.cli().status, 0); assert.equal(r.summary().testTotals.skipped, 1);
  r.put('tests/skip-panel.test.ts', 'import{test}from"node:test";test.skip("ui not executed",()=>{});');
  r.inventory.files.push({ file: 'tests/skip-panel.test.ts', executor: 'node', scopes: ['all'] });
  r.put('scripts/test-inventory.json', JSON.stringify(r.inventory)); r.commit();
  r.put('tests/skip-panel.test.ts', 'import{test}from"node:test";test.skip("ui not executed",()=>{}); // modified');
  // 隔离调度fixture只验证skip政策，不冒称真实浏览器验收。
  const previous = process.env.CHROME_BIN; process.env.CHROME_BIN = process.execPath;
  try {
    const result = r.cli(); assert.equal(result.status, 1, result.stderr);
    const summary = r.summary(); assert.equal(summary.uiLocalFeedback, 'failed'); assert.equal(summary.testTotals.skipped, 1);
    const pending = JSON.parse(readFileSync(join(r.root, 'logs/check-state/failures.json'), 'utf8'));
    assert.ok(pending.failures.some((item: any) => item.file === 'tests/skip-panel.test.ts' && item.name === 'ui not executed'));
  } finally { if (previous === undefined) delete process.env.CHROME_BIN; else process.env.CHROME_BIN = previous; }
});

test('非法基准不回退HEAD；未知导入、动态执行与解析错误选择保守全范围', t => {
  const r = repository(t);
  assert.equal(r.cli('--plan', '--base', 'does-not-exist').status, 1);
  for (const source of [
    'import "../missing.js";export const value=7;',
    'const file="./other.js";import(file);export const value=7;',
    'import{spawn as run}from"node:child_process";export const value=7;',
    'export const broken = ;',
  ]) {
    r.put('src/number.ts', source);
    assert.deepEqual(r.plan().selected, ['tests/number.test.ts', 'tests/style-collisions.test.ts', 'tests/text-search.test.ts']);
  }
});

test('面板中的未知外部输入不能仅凭面板映射缩小范围', t => {
  const r = repository(t);
  r.put('src/panel/value.ts', 'import{readFile as load}from"node:fs/promises";export const value=7;');
  const plan = r.plan();
  assert.deepEqual(plan.selected, ['tests/number.test.ts', 'tests/style-collisions.test.ts', 'tests/text-search.test.ts']);
  assert.ok(plan.reasons.some((reason: any) => reason.rule === 'opaque-input'));
});

test('UI跳过待办在集中复验中仍阻塞，不能清单后再次执行或称复验通过', t => {
  const r = repository(t);
  r.put('tests/skip-panel.test.ts', 'import{test}from"node:test";test.skip("still no UI execution",()=>{});');
  r.inventory.files.push({ file: 'tests/skip-panel.test.ts', executor: 'node', scopes: ['all'] });
  r.put('scripts/test-inventory.json', JSON.stringify(r.inventory)); r.commit();
  r.put('tests/skip-panel.test.ts', 'import{test}from"node:test";test.skip("still no UI execution",()=>{}); // edit');
  const previous = process.env.CHROME_BIN; process.env.CHROME_BIN = process.execPath;
  try {
    assert.equal(r.cli().status, 1); assert.equal(r.cli().status, 1);
    const summary = r.summary(); assert.equal(summary.blocked, true);
    assert.equal(summary.recheck.status, 'failed'); assert.deepEqual(summary.results, []);
    assert.equal(existsSync(join(r.root, 'logs/check-state/failures.json')), true);
  } finally { if (previous === undefined) delete process.env.CHROME_BIN; else process.env.CHROME_BIN = previous; }
});

test('既有配置中的陌生alias也不能被硬编码图误判为完整静态影响', t => {
  const r = repository(t);
  r.put('tsconfig.json', JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }));
  r.put('src/panel/number.ts', 'export const value=999;');
  r.put('tests/alias.test.ts', 'import{test}from"node:test";import{value}from"@/number.js";test("alias consumer",()=>{});');
  r.inventory.files.push({ file: 'tests/alias.test.ts', executor: 'node', scopes: ['all'] });
  r.put('scripts/test-inventory.json', JSON.stringify(r.inventory)); r.commit();
  r.put('src/number.ts', 'export const value=7; // changed\n');
  const plan = r.plan(); assert.equal(plan.selected.length, 4);
  assert.ok(plan.reasons.some((reason: any) => reason.rule === 'unknown-dependency'));
});

test('读取源码文本的literal消费者随源文件修改执行，无关literal输入仍可精确排除', t => {
  const r = repository(t);
  r.put('tests/number.test.ts', 'import{test}from"node:test";import{value}from"../src/number.js";test("static accepts positive",()=>{if(value<=0)throw Error("negative")});');
  r.put('tests/opaque.test.ts', 'import{test}from"node:test";import{readFileSync as load}from"node:fs";test("source text stays seven",()=>{if(!load(new URL("../src/number.ts",import.meta.url),"utf8").includes("value = 7"))throw Error("text changed");});');
  r.put('tests/other.test.ts', 'import{test}from"node:test";import{other}from"../src/other.js";test("other",()=>{if(other<=0)throw Error("negative")});');
  r.inventory.files.push({ file: 'tests/opaque.test.ts', executor: 'node', scopes: ['all'] }, { file: 'tests/other.test.ts', executor: 'node', scopes: ['all'] });
  r.put('scripts/test-inventory.json', JSON.stringify(r.inventory)); r.commit();
  r.put('src/number.ts', 'export const value = 8;\n');
  const result = r.cli(); assert.equal(result.status, 1, result.stderr);
  let summary = r.summary(); assert.deepEqual(summary.expected.files, ['tests/number.test.ts', 'tests/opaque.test.ts']);
  assert.ok(summary.failures.some((item: any) => item.file === 'tests/opaque.test.ts' && item.name === 'source text stays seven'));
  r.git('checkout', '--', '.'); rmSync(join(r.root, 'logs'), { recursive: true, force: true });
  r.put('src/other.ts', 'export const other = 3;\n');
  assert.deepEqual(r.plan().selected, ['tests/other.test.ts']);
});

test('未知读取能力位于共享源码中时也保守纳入其测试消费者，literal文档读取优先于文档白名单', t => {
  const r = repository(t);
  r.put('src/reader.ts', 'import{readFileSync}from"node:fs";export const read=(file:string)=>readFileSync(file,"utf8");');
  r.put('tests/reader.test.ts', 'import{test}from"node:test";import{read}from"../src/reader.js";test("unknown reader",()=>{});');
  r.put('README.md', 'known text\n');
  r.put('tests/readme.test.ts', 'import{test}from"node:test";import{readFileSync}from"node:fs";test("readme",()=>readFileSync(new URL("../README.md",import.meta.url),"utf8"));');
  r.inventory.files.push({ file: 'tests/reader.test.ts', executor: 'node', scopes: ['all'] }, { file: 'tests/readme.test.ts', executor: 'node', scopes: ['all'] });
  r.put('scripts/test-inventory.json', JSON.stringify(r.inventory)); r.commit();
  r.put('src/number.ts', 'export const value = 8;\n');
  assert.deepEqual(r.plan().selected, ['tests/number.test.ts', 'tests/reader.test.ts']);
  r.git('checkout', '--', '.'); r.put('README.md', 'new text\n');
  const plan = r.plan(); assert.deepEqual(plan.selected, ['tests/reader.test.ts', 'tests/readme.test.ts']);
  assert.ok(plan.reasons.some((reason: any) => reason.rule === 'literal-file-input'));
});

test('fs子对象计算调用、逃逸、反射及非确认URL绑定都按未知能力保守选中', t => {
  const variants = [
    ['computed-promises', 'import*as fs from"node:fs";', 'const method="readFile";const text=await fs.promises[method](new URL("../src/number.ts",import.meta.url),"utf8");'],
    ['escaped-promises', 'import*as fs from"node:fs";', 'const io=fs.promises;const method="readFile";const text=await io[method](new URL("../src/number.ts",import.meta.url),"utf8");'],
    ['reflected-promises', 'import*as fs from"node:fs";', 'const method="readFile";const text=await Reflect.get(fs.promises,method)(new URL("../src/number.ts",import.meta.url),"utf8");'],
    ['destructured-promises', 'import*as fs from"node:fs";', 'const {promises:io}=fs;const method="readFile";const text=await io[method](new URL("../src/number.ts",import.meta.url),"utf8");'],
    ['shadow-class', 'import{readFileSync}from"node:fs";import{URL as NativeURL}from"node:url";class URL{constructor(){return new NativeURL("../src/number.ts",import.meta.url)}}', 'const text=readFileSync(new URL("../src/other.ts",import.meta.url),"utf8");'],
    ['shadow-import', 'import{readFileSync}from"node:fs";import{URL}from"../src/custom-url.js";', 'const text=readFileSync(new URL("../src/other.ts",import.meta.url),"utf8");'],
    ['metadata-reader', 'import{statSync as inspect}from"node:fs";', 'const text=inspect(new URL("../src/number.ts",import.meta.url)).size===23?"value = 7":"changed";'],
  ] as const;
  const observed = [];
  for (const [variant, imports, body] of variants) {
    const r = repository(t);
    r.put('src/custom-url.ts', 'import{URL as NativeURL}from"node:url";export class URL{constructor(){return new NativeURL("./number.ts",import.meta.url)}}');
    r.put('tests/number.test.ts', 'import{test}from"node:test";import{value}from"../src/number.js";test("static accepts positive",()=>{if(value<=0)throw Error("negative")});');
    r.put('tests/opaque.test.ts', `import{test}from"node:test";${imports}test("unknown capability",async()=>{${body}if(!text.includes("value = 7"))throw Error("source changed");});`);
    r.inventory.files.push({ file: 'tests/opaque.test.ts', executor: 'node', scopes: ['all'] });
    r.put('scripts/test-inventory.json', JSON.stringify(r.inventory)); r.commit();
    r.put('src/number.ts', 'export const value = 88;\n');
    const result = r.cli(), summary = r.summary();
    observed.push({ variant, code: result.status, files: summary.expected.files, failedOwner: summary.failures.some((item: any) => item.file === 'tests/opaque.test.ts') });
  }
  assert.deepEqual(observed, variants.map(([variant]) => ({ variant, code: 1, files: ['tests/number.test.ts', 'tests/opaque.test.ts'], failedOwner: true })));
});

test('字符串执行、动态模块与其别名能力不能遗漏静态图之外的实际消费者', t => {
  const variants = [
    ['eval', '.ts', '', 'const value=(await eval("import(\'../src/number.ts\')")).value;'],
    ['eval-alias', '.ts', 'const execute=eval;', 'const value=(await execute("import(\'../src/number.ts\')")).value;'],
    ['function-alias', '.ts', 'const Execute=Function;', 'const value=await new Execute("return import(\'../src/number.ts\').then(m=>m.value)")();'],
    ['reflected-global', '.ts', 'const execute=Reflect.get(globalThis,"eval");', 'const value=(await execute("import(\'../src/number.ts\')")).value;'],
    ['vm-alias', '.ts', 'import{runInThisContext as execute}from"node:vm";', 'const value=Number(execute("process.getBuiltinModule(\'fs\').readFileSync(\'src/number.ts\',\'utf8\')").match(/value = (\\d+)/)[1]);'],
    ['require-alias', '.cjs', 'const{test}=require("node:test");const load=require;const fs=load("node:fs");', 'const operation="readFileSync";const value=Number(fs[operation]("src/number.ts","utf8").match(/value = (\\d+)/)[1]);'],
    ['module-require-alias', '.cjs', 'const{test}=require("node:test");const load=module.require.bind(module);const fs=load("node:fs");', 'const value=Number(fs.readFileSync("src/number.ts","utf8").match(/value = (\\d+)/)[1]);'],
  ] as const;
  const observed = [];
  for (const [variant, extension, imports, body] of variants) {
    const r = repository(t), file = `tests/dynamic.test${extension}`;
    r.put('tests/number.test.ts', 'import{test}from"node:test";import{value}from"../src/number.js";test("static accepts positive",()=>{if(value<=0)throw Error("negative")});');
    r.put(file, `${extension === '.ts' ? 'import{test}from"node:test";' : ''}${imports}test("dynamic source consumer",async()=>{${body}if(value!==7)throw Error("source changed");});`);
    r.inventory.files.push({ file, executor: 'node', scopes: ['all'] });
    r.put('scripts/test-inventory.json', JSON.stringify(r.inventory)); r.commit();
    const baseline = spawnSync(process.execPath, ['--import', 'tsx', '--test', file], { cwd: r.root, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined }, timeout: 10000 });
    assert.equal(baseline.status, 0, `${variant}: ${baseline.stdout}\n${baseline.stderr}`);
    r.put('src/number.ts', 'export const value = 8;\n');
    const result = r.cli(), summary = r.summary();
    observed.push({ variant, code: result.status, files: summary.expected.files, failedOwner: summary.failures.some((item: any) => item.file === file) });
  }
  assert.deepEqual(observed, variants.map(([variant, extension]) => ({ variant, code: 1, files: [`tests/dynamic.test${extension}`, 'tests/number.test.ts'], failedOwner: true })));
});

test('可信 UI 政策覆盖无 panel 后缀的文件，浏览器要求与严格待办一致', t => {
  const r=repository(t),file='tests/widget.test.ts';
  r.put(file,'import{test}from"node:test";test.skip("必须实际执行的业务UI",()=>{});');
  r.put('scripts/test-inventory.json',JSON.stringify({...r.inventory,files:[...r.inventory.files,{file,executor:'node',scopes:['all'],policy:'ui'}]}));r.commit();r.put(file,readFileSync(join(r.root,file),'utf8')+'\n// 本次改动\n');
  const plan=r.plan();assert.deepEqual(plan.uiFiles,[file]);assert.equal(plan.browserRequired,true);
  const first=r.cli();assert.notEqual(first.status,0,first.stdout+first.stderr);
  const manifest=JSON.parse(readFileSync(join(r.root,'logs/check-state/failures.json'),'utf8'));assert.deepEqual(manifest.strictTestFiles,[file]);
  const next=r.cli();assert.notEqual(next.status,0);assert.equal(r.summary().blocked,true);assert.equal(r.summary().recheck.status,'failed');
});
