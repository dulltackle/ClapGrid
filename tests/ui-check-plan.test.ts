import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';

// 原 Node 默认未限时；保留原计划与缺浏览器断言。
vi.setConfig({ testTimeout: 0, hookTimeout: 0 });

const planner = await import(new URL('../scripts/ui-check-plan.mjs', import.meta.url).href);
const checker = await import(new URL('../scripts/check-ui.mjs', import.meta.url).href);
const root = fileURLToPath(new URL('../', import.meta.url));
const themePath = 'src/panel/app.tsx';
const themeSource = `import { themeQuartz } from 'ag-grid-community';
const theme = themeQuartz.withParams({
  browserColorScheme: 'light', accentColor: 'blue', backgroundColor: 'white',
  foregroundColor: 'black', borderColor: 'gray', headerBackgroundColor: 'white',
  headerTextColor: 'black', rowHoverColor: 'silver', fontFamily: 'sans-serif',
  fontSize: 14, spacing: 4, borderRadius: 6, wrapperBorderRadius: 8,
  headerHeight: 38, rowHeight: 102, pinnedColumnBorder: false, columnBorder: false,
});
const view = <button className="p-1" onClick={save}/>;`;

test('UI 固定核心保留点击范围检查，row 子集不能规避交互变更升级', () => {
  const changes = [{ path: 'src/panel/segment-row.tsx', before: '<button onClick={save} className="p-1"/>', after: '<button onClick={remove} className="p-2"/>' }];
  const plan = planner.createUiPlan(root, { scope: 'row', changes });
  assert.equal(plan.requiredFollowup, 'full-check');
  assert.ok(plan.tests.includes('tests/table-controls-panel.test.ts'));
  assert.ok(plan.tests.includes('tests/segment-draft-panel.test.ts'));
  assert.ok(plan.tests.includes('tests/row-menu-panel.test.ts'));
});

test('静态 className 和现有 CSS 声明可使用 UI 范围，动态表达式和扫描配置保守升级', () => {
  const path = 'src/panel/segment-row.tsx';
  assert.equal(planner.isStaticStyleChange(path, '<div className="p-1"/>', '<div className="p-2"/>'), true);
  assert.equal(planner.isStaticStyleChange(path, '<div className={active ? "p-1" : "p-2"}/>', '<div className={other ? "p-1" : "p-2"}/>'), false);
  assert.equal(planner.isStaticStyleChange('src/panel/style.css', ':root { color: red }', ':root { color: blue }'), true);
  assert.equal(planner.isStaticStyleChange('src/panel/style.css', '@import "a.css";', '@import "b.css";'), false);
  assert.equal(planner.isStaticStyleChange(path, undefined, '<div/>'), false);
});

test('实际表格主题的七个既有颜色字段允许静态字符串替换并可混合静态 className', () => {
  for (const [field, value] of Object.entries({
    accentColor: 'blue', backgroundColor: 'white', foregroundColor: 'black', borderColor: 'gray',
    headerBackgroundColor: 'white', headerTextColor: 'black', rowHoverColor: 'silver',
  })) {
    const after = themeSource.replace(`${field}: '${value}'`, `${field}: 'var(--color-surface)'`);
    assert.equal(planner.isStaticStyleChange(themePath, themeSource, after), true, field);
    assert.equal(planner.isStaticStyleChange(themePath, after, themeSource), true, `${field} 反向替换`);
  }
  for (const value of ["'color-mix(in srgb, var(--color-focus) 2%, white)'", '`var(--color-surface)`']) {
    const after = themeSource.replace("backgroundColor: 'white'", `backgroundColor: ${value}`).replace('className="p-1"', 'className="p-2"');
    assert.equal(planner.isStaticStyleChange(themePath, themeSource, after), true, value);
  }
});

test('主题颜色识别只匹配真实导入及顶层直接主题配置', () => {
  const variants = [
    themeSource.replace('ag-grid-community', 'another-grid'),
    themeSource.replace('{ themeQuartz }', '{ type themeQuartz }'),
    themeSource.replace('import {', 'import type {'),
    themeSource.replaceAll('themeQuartz', 'customTheme'),
    themeSource.replace('const theme =', 'const anotherTheme ='),
    themeSource.replace('const theme =', 'let theme ='),
    themeSource.replace('themeQuartz.withParams', 'themeQuartz["withParams"]'),
    themeSource.replace('themeQuartz.withParams', 'themeQuartz?.withParams'),
    themeSource.replace('themeQuartz.withParams(', 'themeQuartz.withParams?.('),
    themeSource.replace('});', '}, extra);'),
    `function makeTheme(themeQuartz) { ${themeSource.replace(/^import[^\n]+\n/, '')} }`,
  ];
  for (const before of variants) {
    assert.equal(planner.isStaticStyleChange(themePath, before, before.replace("backgroundColor: 'white'", "backgroundColor: 'red'")), false, before);
  }
  assert.equal(planner.isStaticStyleChange('src/panel/other.tsx', themeSource, themeSource.replace("backgroundColor: 'white'", "backgroundColor: 'red'")), false);
  const unknownColor = themeSource.replace('backgroundColor:', 'unknownColor:');
  assert.equal(planner.isStaticStyleChange(themePath, unknownColor, unknownColor.replace("unknownColor: 'white'", "unknownColor: 'red'")), false);
});

test('动态颜色、配置结构、非颜色参数及逻辑混改仍要求完整检查', () => {
  const colorChange = themeSource.replace("backgroundColor: 'white'", "backgroundColor: 'var(--color-surface)'");
  const changes = [
    ...['surfaceColor', 'getColor()', "active ? 'red' : 'blue'", '`var(--${color})`', '42'].map(value => themeSource.replace("backgroundColor: 'white'", `backgroundColor: ${value}`)),
    themeSource.replace("backgroundColor: 'white',", ''),
    colorChange.replace("accentColor: 'blue',", ''),
    colorChange.replace("browserColorScheme: 'light'", "newColor: 'red', browserColorScheme: 'light'"),
    colorChange.replace("browserColorScheme: 'light'", "browserColorScheme: 'dark'"),
    colorChange.replace("fontFamily: 'sans-serif'", "fontFamily: 'serif'"),
    ...['fontSize: 14', 'spacing: 4', 'borderRadius: 6', 'wrapperBorderRadius: 8', 'headerHeight: 38', 'rowHeight: 102'].map(value => colorChange.replace(value, value.replace(/\d+$/, '20'))),
    colorChange.replace('pinnedColumnBorder: false', 'pinnedColumnBorder: true'),
    colorChange.replace('columnBorder: false', 'columnBorder: true'),
    colorChange.replace('onClick={save}', 'onClick={remove}'),
    colorChange.replace('ag-grid-community', 'another-grid'),
    colorChange.replace('themeQuartz.withParams', 'customTheme.withParams'),
    colorChange.replace('themeQuartz.withParams({', 'themeQuartz.withParams({ ...overrides,'),
    colorChange.replace('backgroundColor:', '[colorKey]:'),
    colorChange.replace('backgroundColor:', "['backgroundColor']:"),
  ];
  for (const after of changes) {
    assert.equal(planner.isStaticStyleChange(themePath, themeSource, after), false, after);
    assert.equal(planner.isStaticStyleChange(themePath, after, themeSource), false, `反向：${after}`);
  }
  for (const prefix of ["...overrides,", "['fontSize']: 12,", "backgroundColor: 'black',", 'get extra() { return overrides; },']) {
    const before = themeSource.replace('themeQuartz.withParams({', `themeQuartz.withParams({ ${prefix}`);
    assert.equal(planner.isStaticStyleChange(themePath, before, before.replace("backgroundColor: 'white'", "backgroundColor: 'red'")), false, prefix);
  }
});

test('主题颜色放行仍保留全部面板浏览器测试，row 范围与其他文件不绕过升级', () => {
  const colorChange = { path: themePath, before: themeSource, after: themeSource.replace("backgroundColor: 'white'", "backgroundColor: 'red'") };
  const allUi = readdirSync(new URL('../tests/', import.meta.url)).filter(name => name.endsWith('-panel.test.ts')).map(name => `tests/${name}`);
  for (const scope of ['row', 'extended']) {
    const plan = planner.createUiPlan(root, { scope, changes: [colorChange] });
    assert.equal(plan.requiredFollowup, null);
    assert.deepEqual(plan.nonStyleFiles, []);
    assert.ok(allUi.every(path => plan.tests.includes(path)));
    assert.equal(plan.maxConcurrency, 1);
    const mixed = planner.createUiPlan(root, { scope, changes: [colorChange, { path: 'package-lock.json', before: 'a', after: 'b' }] });
    assert.equal(mixed.requiredFollowup, 'full-check');
    assert.deepEqual(mixed.nonStyleFiles, ['package-lock.json']);
  }
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
