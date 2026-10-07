import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPanelStyles } from './helpers/panel-styles.js';

const checker = new URL('../scripts/style-collisions.mjs', import.meta.url).href;
const { checkStyleCollisions } = await import(checker);
const root = fileURLToPath(new URL('../', import.meta.url));

test('解析生成工具类的转义与嵌套，拒绝同名冲突和无效例外', () => {
  const generated = String.raw`@layer utilities { .flex {display:flex} @media (width > 100px) { .grid {display:grid} .sm\:grid {display:grid} } }`;
  assert.throws(() => checkStyleCollisions('.grid {width:100%}', generated), /grid/);
  assert.throws(() => checkStyleCollisions(String.raw`.sm\:grid {width:100%}`, generated), /sm:grid/);
  assert.doesNotThrow(() => checkStyleCollisions('.grid-view {}', generated));
  assert.doesNotThrow(() => checkStyleCollisions('.grid {}', generated, [{ className: 'grid', reason: '明确共用同一布局语义，已审查' }]));
  assert.throws(() => checkStyleCollisions('.grid {}', generated, [{ className: 'grid', reason: '' }]), /理由/);
  assert.throws(() => checkStyleCollisions('.legacy {}', generated, [{ className: 'grid', reason: '旧理由' }]), /失效/);
  assert.throws(() => checkStyleCollisions('.grid {}', '.grid {}'), /未找到/);
});

test('生产同源 CSS 的工具类不得覆盖既有业务类名', async t => {
  const output = mkdtempSync(join(tmpdir(), 'clapgrid-style-check-'));
  t.after(() => rmSync(output, { recursive: true, force: true }));
  await buildPanelStyles(output);
  const panel = join(root, 'src/panel');
  const files = readdirSync(panel, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.css'));
  const authored = files.map(entry => readFileSync(join(entry.parentPath, entry.name), 'utf8')).join('\n');
  const generated = readFileSync(join(output, 'test.css'), 'utf8');
  const exceptions = JSON.parse(readFileSync(join(root, 'scripts/style-collision-exceptions.json'), 'utf8'));
  assert.doesNotThrow(() => checkStyleCollisions(authored, generated, exceptions));
  // 使用真实产物注入历史 .grid 冲突，证明门槛能拦截复发。
  assert.throws(() => checkStyleCollisions(authored, generated + '@layer utilities {.grid {display:grid}}', exceptions), /grid/);
});
