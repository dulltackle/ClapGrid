import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const planner = await import(new URL('../scripts/ui-check-plan.mjs', import.meta.url).href);
const checker = await import(new URL('../scripts/check-ui.mjs', import.meta.url).href);
const root = fileURLToPath(new URL('../', import.meta.url));

test('UI 固定核心保留点击范围检查，row 子集不能规避交互变更升级', () => {
  const changes = [{ path: 'src/panel/segment-row.tsx', before: '<button onClick={save} className="p-1"/>', after: '<button onClick={remove} className="p-2"/>' }];
  const plan = planner.createUiPlan(root, { scope: 'row', changes });
  assert.equal(plan.requiredFollowup, 'full-check');
  assert.ok(plan.tests.includes('tests/table-controls-panel.test.ts'));
  assert.ok(plan.tests.includes('tests/segment-draft-panel.test.ts'));
  assert.ok(plan.tests.includes('tests/row-menu-panel.test.ts'));
});

test('仅静态 className 和现有 CSS 声明可使用 UI 范围，动态表达式和扫描配置保守升级', () => {
  const path = 'src/panel/segment-row.tsx';
  assert.equal(planner.isStaticStyleChange(path, '<div className="p-1"/>', '<div className="p-2"/>'), true);
  assert.equal(planner.isStaticStyleChange(path, '<div className={active ? "p-1" : "p-2"}/>', '<div className={other ? "p-1" : "p-2"}/>'), false);
  assert.equal(planner.isStaticStyleChange('src/panel/style.css', ':root { color: red }', ':root { color: blue }'), true);
  assert.equal(planner.isStaticStyleChange('src/panel/style.css', '@import "a.css";', '@import "b.css";'), false);
  assert.equal(planner.isStaticStyleChange(path, undefined, '<div/>'), false);
});

test('组件映射追加真实专项，未知源码与依赖升级完整范围，文档不伪装源码变更', () => {
  const menu = planner.createUiPlan(root, { changes: [{ path: 'src/panel/row-menu.tsx', before: '<div className="p-1"/>', after: '<div className="p-2"/>' }] });
  assert.equal(menu.requiredFollowup, null);
  assert.ok(menu.tests.includes('tests/row-menu-panel.test.ts'));
  for (const path of ['src/service/speech.ts', 'package-lock.json', 'scripts/check-ui.mjs']) {
    assert.equal(planner.createUiPlan(root, { changes: [{ path, before: 'a', after: 'b' }] }).requiredFollowup, 'full-check');
  }
  const docs = planner.createUiPlan(root, { changes: [{ path: 'docs/agents/verification.md', before: 'a', after: 'b' }] });
  assert.equal(docs.requiredFollowup, null);
  assert.equal(docs.tests.length, 8);
});

test('缺少指定 Chrome 直接失败，不能继承测试文件中的旧 skip', () => {
  assert.throws(() => checker.requireChrome({ ...process.env, CHROME_BIN: '/definitely-missing-clapgrid-browser' }), /缺失浏览器不能跳过/);
});
