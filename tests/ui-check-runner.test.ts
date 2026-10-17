import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const { checkUi } = await import(new URL('../scripts/check-ui.mjs', import.meta.url).href);
const { extendedTests } = await import(new URL('../scripts/ui-check-plan.mjs', import.meta.url).href);
const { runCheck } = await import(new URL('../scripts/check-runner.mjs', import.meta.url).href);

function repository(t: TestContext, typecheck = 'process.exit(0)') {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-ui-check-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q'); mkdirSync(join(root, 'tests')); mkdirSync(join(root, 'src'));
  writeFileSync(join(root, '.gitignore'), 'logs/\nnode_modules/\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'ui-check-fixture', private: true, type: 'module', scripts: { typecheck: 'node task.cjs', build: 'node -e "process.exit(0)"' } }));
  writeFileSync(join(root, 'task.cjs'), typecheck); writeFileSync(join(root, 'src/value.ts'), 'original');
  for (const path of extendedTests) writeFileSync(join(root, path), 'import {test} from "node:test"; test("fixture stage", () => {});');
  symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), join(root, 'node_modules'), 'dir');
  git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  // 本组验证调度与证据；真实 Chrome 运行另由 panel 用例覆盖。
  const previous = process.env.CHROME_BIN; process.env.CHROME_BIN = process.execPath;
  t.after(() => { if (previous === undefined) delete process.env.CHROME_BIN; else process.env.CHROME_BIN = previous; });
  return root;
}

test('UI 开发证据记录固定核心、源码身份与全部阶段，不称为正式验收', async t => {
  const root = repository(t); const result = await checkUi(root);
  assert.equal(result.status, 'passed', result.error); assert.equal(result.mode, 'ui-development');
  assert.equal(result.completeForLocalUi, true);
  assert.equal(result.requestedConcurrency, 2); assert.equal(result.effectiveConcurrency, 2);
  assert.deepEqual(result.results.map((stage: { name: string }) => stage.name), ['typecheck', 'ui-tests', 'build']);
  assert.equal(result.source.fingerprint, result.sourceAfter.fingerprint);
  assert.ok(readFileSync(join(result.directory, 'ui-tests.log'), 'utf8').includes('# pass 8'));
});

test('安全 UI 范围仍可显式降为串行，非法并发不执行阶段', async t => {
  const root = repository(t); const result = await checkUi(root, { concurrency: 1 });
  assert.equal(result.status, 'passed', result.error);
  assert.equal(result.requestedConcurrency, 1); assert.equal(result.effectiveConcurrency, 1);
  const invalid = await checkUi(root, { concurrency: 3 });
  assert.equal(invalid.status, 'failed'); assert.match(invalid.error, /仅支持 1 或 2/);
  assert.equal(invalid.results.length, 0);
});

test('未知非样式源码即使 UI 子集通过也保留完整检查待办', async t => {
  const root = repository(t); writeFileSync(join(root, 'src/value.ts'), 'interaction changed');
  const result = await checkUi(root, { scope: 'row', concurrency: 2 });
  assert.equal(result.status, 'requires-full-check', result.error); assert.equal(result.completeForLocalUi, false);
  assert.equal(result.plan.requiredFollowup, 'full-check');
  assert.equal(result.effectiveConcurrency, 1);
});

test('UI 检查期间源码变化立即失效，不能继续测试或构建', async t => {
  const root = repository(t, 'require("node:fs").writeFileSync("src/value.ts", "changed")');
  const result = await checkUi(root);
  assert.equal(result.status, 'invalidated'); assert.equal(result.completeForLocalUi, false);
  assert.deepEqual(result.results.map((stage: { name: string }) => stage.name), ['typecheck']);
});

test('退出零但核心用例被标为 todo 不能获得通过证据', async t => {
  const root = repository(t);
  writeFileSync(join(root, 'tests/table-controls-panel.test.ts'), 'import {test} from "node:test"; test.todo("点击范围尚未检查");');
  const result = await checkUi(root);
  assert.equal(result.status, 'failed'); assert.equal(result.completeForLocalUi, false);
  assert.equal(result.testTotals.todo, 1); assert.equal(result.testTotals.failed, 0);
  assert.equal(result.results.at(-1).exitCode, 0);
  assert.equal(result.results.at(-1).status, 'failed');
  assert.deepEqual(result.results.map((stage: { name: string }) => stage.name), ['typecheck', 'ui-tests']);
});

test('UI快检占用统一生命周期，取消后不进入测试和构建', async t => {
  const root = repository(t, 'require("node:fs").mkdirSync("logs",{recursive:true});require("node:fs").writeFileSync("logs/started","yes");setInterval(()=>{},1000)');
  const controller = new AbortController();
  const pending = checkUi(root, { signal: controller.signal });
  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(join(root, 'logs/started')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(existsSync(join(root, 'logs/started')));
    await assert.rejects(runCheck(root), /已有检查/);
  } finally { controller.abort(); }
  const result = await pending;
  assert.equal(result.status, 'cancelled'); assert.equal(result.completeForLocalUi, false);
  assert.deepEqual(result.results.map((stage: any) => stage.name), ['typecheck']);
  assert.equal(existsSync(join(root, 'logs/check-state/active')), false);
});

test('UI失败保留结构化完整失败清单供后续集中复验', async t => {
  const root = repository(t);
  writeFileSync(join(root, 'tests/table-controls-panel.test.ts'), 'import{test}from"node:test";test("点击范围失败",()=>{throw Error("fixture failure")});');
  const result = await checkUi(root);
  assert.equal(result.status, 'failed');
  const manifest = JSON.parse(readFileSync(join(root, 'logs/check-state/failures.json'), 'utf8'));
  assert.deepEqual(manifest.stages, ['test']);
  assert.ok(manifest.failures.some((failure: any) => failure.name === '点击范围失败' && failure.file === 'tests/table-controls-panel.test.ts'));
  const report = JSON.parse(readFileSync(join(result.directory, 'ui-tests.json'), 'utf8'));
  assert.equal(report.complete, true);
  assert.equal(report.failures.length, 1);
});
