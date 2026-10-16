import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { failureFiles } = await import(new URL('../scripts/test-runner.mjs', import.meta.url).href);

test('原生测试报告收齐不同文件及嵌套失败，不把父级汇总重复算作失败', t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-reporter-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'a.test.mjs'), `import {test} from 'node:test'; test('父级',async t=>{await t.test('失败一',()=>{throw Error('first')})});`);
  writeFileSync(join(root, 'b.test.mjs'), `import {test} from 'node:test'; test('失败二',()=>{throw Error('second')});test('成功',()=>{});`);
  const report = join(root, 'result.json');
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  assert.throws(() => execFileSync(process.execPath, ['--test', '--test-concurrency=1', `--test-reporter=${fileURLToPath(new URL('../scripts/test-reporter.mjs', import.meta.url))}`, `--test-reporter-destination=${report}`, join(root, 'a.test.mjs'), join(root, 'b.test.mjs')], { stdio: 'ignore', env }));
  const result = JSON.parse(readFileSync(report, 'utf8'));
  assert.equal(result.complete, true);
  assert.deepEqual(result.failures.map((failure: any) => failure.name).sort(), ['失败一', '失败二']);
  assert.ok(result.failures.every((failure: any) => failure.file && failure.message));
});

test('失败复验使用新检出中的全部失败文件，拒绝丢失文件和越界路径', t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-failure-files-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'tests'));
  for (const file of ['a.test.ts', 'b.test.ts']) writeFileSync(join(root, 'tests', file), '');
  assert.deepEqual(failureFiles(root, [{ file: 'tests/a.test.ts' }, { file: 'tests/b.test.ts' }, { file: 'tests/a.test.ts' }]), ['tests/a.test.ts', 'tests/b.test.ts']);
  assert.throws(() => failureFiles(root, [{ file: '../other/tests/a.test.ts' }]), /无法定位/);
  assert.throws(() => failureFiles(root, [{ file: 'tests/missing.test.ts' }]), /无法定位/);
});
