import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseSync } from 'rolldown/utils';
import { git } from './check-source.mjs';

/** 固定核心保留点击范围、虚拟行、双层布局和真实视口检查，不能按变更临时删减。 */
export const rowTests = [
  'tests/style-collisions.test.ts', 'tests/table-controls-panel.test.ts',
  'tests/segment-note-layout-panel.test.ts', 'tests/speech-cell-layout-panel.test.ts', 'tests/wide-panel.test.ts',
];
export const extendedTests = [...rowTests, 'tests/long-text-panel.test.ts', 'tests/row-hover-panel.test.ts', 'tests/visual-note-panel.test.ts'];
export const componentTests = [
  { pattern: /(?:row-menu|selection-menu|context-menu|alert-dialog|delete-confirm)/, tests: ['row-menu', 'selection-menu', 'row-selection'] },
  { pattern: /(?:text-editor|segment-draft|segment-focus|editing)/, tests: ['segment-draft', 'segment-focus', 'long-text', 'editing'] },
  { pattern: /(?:detail|dialog|focus)/, tests: ['segment-details-focus', 'segment-focus', 'segment-draft'] },
  { pattern: /(?:speech|voice)/, tests: ['audio', 'voice', 'speech-cell-layout'] },
  { pattern: /(?:visual-note|segment-row)/, tests: ['visual-note', 'segment-note-layout', 'speech-cell-layout', 'table-controls'] },
  { pattern: /(?:video|media)/, tests: ['media', 'video', 'video-preview'] },
  { pattern: /(?:search|selection)/, tests: ['search', 'selection', 'selection-menu', 'row-selection'] },
  { pattern: /(?:shell|toolbar|task|more)/, tests: ['shell', 'more-tasks'] },
  { pattern: /(?:add|paste|insert|drag)/, tests: ['ordinary-add-focus', 'paste', 'relative-insert', 'relative-insert-lifecycle', 'drag'] },
];

const themeColorFields = new Set([
  'accentColor', 'backgroundColor', 'foregroundColor', 'borderColor',
  'headerBackgroundColor', 'headerTextColor', 'rowHoverColor',
]);
const isStaticString = node => (node?.type === 'Literal' && typeof node.value === 'string') ||
  (node?.type === 'TemplateLiteral' && node.expressions.length === 0);

function staticThemeColors(program, file) {
  const values = new Set();
  if (file !== 'src/panel/app.tsx') return values;
  const imported = program.body.some(node => node.type === 'ImportDeclaration' && node.importKind === 'value' &&
    node.source.value === 'ag-grid-community' && node.specifiers.some(specifier => specifier.type === 'ImportSpecifier' &&
      specifier.importKind === 'value' && specifier.imported.name === 'themeQuartz' && specifier.local.name === 'themeQuartz'));
  if (!imported) return values;
  const themes = program.body.filter(node => node.type === 'VariableDeclaration' && node.kind === 'const')
    .flatMap(node => node.declarations).filter(node => node.id.type === 'Identifier' && node.id.name === 'theme');
  if (themes.length !== 1) return values;
  const call = themes[0].init;
  if (call?.type !== 'CallExpression' || call.optional || call.arguments.length !== 1) return values;
  const callee = call.callee;
  if (callee.type !== 'MemberExpression' || callee.computed || callee.optional ||
    callee.object.type !== 'Identifier' || callee.object.name !== 'themeQuartz' ||
    callee.property.type !== 'Identifier' || callee.property.name !== 'withParams') return values;
  const params = call.arguments[0];
  if (params.type !== 'ObjectExpression') return values;
  const keys = new Set();
  for (const property of params.properties) {
    if (property.type !== 'Property' || property.kind !== 'init' || property.computed || property.method || property.shorthand) return new Set();
    const key = property.key.type === 'Identifier' ? property.key.name : property.key.value;
    if (typeof key !== 'string' || keys.has(key)) return new Set();
    keys.add(key);
    if (themeColorFields.has(key) && isStaticString(property.value)) values.add(property.value);
  }
  return values;
}

function withoutStaticStyles(source, file) {
  let parsed;
  try { parsed = parseSync(file, source); } catch { return undefined; }
  if (parsed.errors.length) return undefined;
  // 仅屏蔽实际主题对象中白名单颜色的静态值；字段、调用与其余源码仍逐项比较。
  const colors = staticThemeColors(parsed.program, file);
  const normalize = node => {
    if (Array.isArray(node)) return node.map(normalize);
    if (!node || typeof node !== 'object') return node;
    if (colors.has(node)) return { type: 'Literal', value: '__static_theme_color__' };
    if (node.type === 'JSXAttribute' && node.name?.name === 'className') {
      const expression = node.value?.type === 'JSXExpressionContainer' ? node.value.expression : node.value;
      if (isStaticString(expression)) {
        return { type: 'JSXAttribute', name: 'className', value: '__static_style__' };
      }
    }
    return Object.fromEntries(Object.entries(node).filter(([key]) => !['start', 'end', 'raw', 'loc', 'range'].includes(key)).map(([key, value]) => [key, normalize(value)]));
  };
  return JSON.stringify(normalize(parsed.program));
}

export function isStaticStyleChange(path, before, after) {
  if (before === undefined || after === undefined || before === after) return false;
  if (path.startsWith('src/panel/') && path.endsWith('.tsx')) {
    const previous = withoutStaticStyles(before, path);
    return previous !== undefined && previous === withoutStaticStyles(after, path);
  }
  if (path.startsWith('src/panel/') && path.endsWith('.css')) {
    const imports = source => source.match(/@(?:import|source|config|plugin)[^;]*;|source\([^)]*\)/g) ?? [];
    return JSON.stringify(imports(before)) === JSON.stringify(imports(after));
  }
  return false;
}

export function createUiPlan(root, { base = 'HEAD', scope = 'extended', changes } = {}) {
  if (!['row', 'extended'].includes(scope)) throw Error('--scope 仅支持 row 或 extended');
  const allUi = readdirSync(join(root, 'tests')).filter(name => name.endsWith('-panel.test.ts')).map(name => `tests/${name}`);
  const baseFiles = changes ? new Set() : new Set(git(root, ['ls-tree', '-r', '--name-only', '-z', base]).split('\0'));
  const changed = changes ?? [...new Set([
    ...git(root, ['diff', '--name-only', '-z', base, '--']).split('\0'),
    ...git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
  ].filter(Boolean))].map(path => {
    let before, after;
    if (baseFiles.has(path)) before = git(root, ['show', `${base}:${path}`]);
    try { after = readFileSync(join(root, path), 'utf8'); } catch { /* 删除文件保守升级。 */ }
    return { path, before, after };
  });
  const substantive = changed.filter(change => !/^(?:docs\/|.*\.md$)/.test(change.path));
  const nonStyle = substantive.filter(change => !isStaticStyleChange(change.path, change.before, change.after));
  const theme = substantive.some(change => /(?:style\.css|components\/ui\/|lib\/utils|\/app\.tsx$)/.test(change.path));
  const tests = new Set(scope === 'row' ? rowTests : extendedTests);
  for (const change of substantive) for (const mapping of componentTests) if (mapping.pattern.test(change.path)) {
    for (const name of mapping.tests) {
      const test = `tests/${name}-panel.test.ts`; if (allUi.includes(test)) tests.add(test);
    }
  }
  if (theme || nonStyle.length) for (const test of allUi) tests.add(test);
  return {
    scope, base, changedFiles: changed.map(change => change.path), tests: [...tests].sort(),
    maxConcurrency: nonStyle.length === 0 && [...tests].every(test => extendedTests.includes(test)) ? 2 : 1,
    requiredFollowup: nonStyle.length ? 'full-check' : null,
    nonStyleFiles: nonStyle.map(change => change.path),
    reason: nonStyle.length ? '含交互、请求、依赖、检查工具或无法证明为静态样式的变更，UI 子集不能替代完整检查。' : '仅核对当前 UI 范围；最终发布仍需固定提交正式验收。',
  };
}
