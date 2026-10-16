import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryBuildCache, buildBrowserScript, treeFiles } from './helpers/browser-build.js';
import { buildPanelStyles } from './helpers/panel-styles.js';

test('构建缓存按内容核对输入与实际 import，不能使用过期依赖或新扫描文件', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'clapgrid-cache-test-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'input'); const dependency = join(dir, 'dependency');
  writeFileSync(input, 'source'); writeFileSync(dependency, 'one');
  let count = 0; const cache = new MemoryBuildCache();
  const compile = async () => ({ bytes: Buffer.from(String(++count)), dependencies: [dependency] });
  assert.equal((await cache.get('key', [input], compile)).cacheHit, false);
  assert.equal((await cache.get('key', [input], compile)).cacheHit, true);
  writeFileSync(dependency, 'two');
  assert.equal((await cache.get('key', [input], compile)).cacheHit, false);
  writeFileSync(join(dir, 'new-source'), 'className="p-3"');
  assert.equal((await cache.get('key', treeFiles(dir), compile)).cacheHit, false);
  assert.equal((await cache.get('other-options', treeFiles(dir), compile)).cacheHit, false);
  assert.equal(count, 4);
});

test('真实 esbuild 跨尺寸复用字节，fixture 和导入文件变更均失效', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'clapgrid-bundle-test-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dependency = join(dir, 'value.js'); writeFileSync(dependency, 'export const value = "first";');
  const script = `import { value } from ${JSON.stringify(dependency)}; console.log(value);`;
  assert.equal((await buildBrowserScript(dir, script, 'fixture-1')).cacheHit, false);
  const first = readFileSync(join(dir, 'test.js'), 'utf8');
  assert.equal((await buildBrowserScript(dir, script, 'fixture-1')).cacheHit, true);
  assert.equal(readFileSync(join(dir, 'test.js'), 'utf8'), first);
  writeFileSync(dependency, 'export const value = "second";');
  assert.equal((await buildBrowserScript(dir, script, 'fixture-1')).cacheHit, false);
  assert.match(readFileSync(join(dir, 'test.js'), 'utf8'), /second/);
  assert.equal((await buildBrowserScript(dir, script, 'fixture-2')).cacheHit, false);
  const defined = 'console.log(__UI_TEST_VALUE__);';
  assert.equal((await buildBrowserScript(dir, defined, '', { __UI_TEST_VALUE__: '1' })).cacheHit, false);
  assert.equal((await buildBrowserScript(dir, defined, '', { __UI_TEST_VALUE__: '1' })).cacheHit, true);
  assert.equal((await buildBrowserScript(dir, defined, '', { __UI_TEST_VALUE__: '2' })).cacheHit, false);
  assert.match(readFileSync(join(dir, 'test.js'), 'utf8'), /console\.log\(2\)/);
});

test('生产同源 CSS 在同一进程复用字节，各场景仍输出到自己的目录', async t => {
  const first = mkdtempSync(join(tmpdir(), 'clapgrid-css-first-')); const second = mkdtempSync(join(tmpdir(), 'clapgrid-css-second-'));
  t.after(() => { rmSync(first, { recursive: true, force: true }); rmSync(second, { recursive: true, force: true }); });
  await buildPanelStyles(first);
  assert.equal((await buildPanelStyles(second)).cacheHit, true);
  assert.deepEqual(readFileSync(join(first, 'test.css')), readFileSync(join(second, 'test.css')));
});
