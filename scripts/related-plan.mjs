import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './check-source.mjs';
import { testInventory, strictTestFiles } from './test-evidence.mjs';
import { relatedDependencies } from './related-dependencies.mjs';
import { isStaticStyleChange, extendedTests, componentTests } from './ui-check-plan.mjs';

const descriptions = {
  'changed-test': '修改已登记测试，执行该文件及其静态消费者。',
  'static-dependents': '当前与基准提交的静态导入及可靠文件读取反向依赖并集。',
  'literal-file-input': '文档仍是实际读取输入，按可靠文件目标选择消费者。',
  'opaque-consumers': '读取、字符串脚本或外部执行的输入无法完整解释，保守纳入其全部测试消费者。',
  'panel-consumers': '逻辑依赖传递到面板，补充字符串浏览器脚本与生产CSS消费者。',
  'non-style-ui': '交互、编辑或无法证明为静态样式；包含全部面板及固定核心，覆盖字符串浏览器脚本。',
  'static-ui-and-component-map': '静态样式：生产CSS扫描输入、固定核心、扩展及已有组件映射。',
  'configuration-or-build': '依赖、配置、执行工具或打包输入无法缩小影响范围。',
  'shared-helper': '共享测试helper可能影响字符串脚本、编译和浏览器输入。',
  'implicit-input': '文件、资源或生产模板是隐式输入，保守执行全部测试。',
  'css-input-rules': 'CSS导入、扫描或插件规则改变，影响生产编译及扫描边界。',
  'opaque-input': '包含无法可靠推断的文件读取、外部进程或动态输入。',
  'unknown-dependency': '源码解析或导入无法可靠解析，不能只依赖静态图。',
  'shared-runtime': '共享协议、服务或运行入口影响未迁移集成与外部进程。',
  'test-removal': '删除测试改变基准覆盖要求，保守扩大并要求完整复验。',
  'conservative-all': '实质输入没有已确认的完整映射，保守扩大。',
  'explicit-all': '显式选择完整测试文件集合；仍不等于完整检查或正式验收。',
  'documentation-only': '仅已确认不作为执行输入的协作文档；没有本次测试通过证据。',
};
const documentation = file => /^(?:README\.md|AGENTS\.md|GLOSSARY\.md|docs\/(?:agents|adr)\/[^/]+\.md)$/.test(file);
const configuration = file => /^(?:package(?:-lock)?\.json|\.node-version|tsconfig[^/]*\.json|(?:vite|vitest|playwright)\.config\.[^/]+|scripts\/|\.github\/|\.codex-plugin\/|\.mcp\.json)/.test(file);

/** 选测只提供当前改动的反馈；完整性与通过政策仍由统一证据校验器承担。 */
export function createRelatedPlan(root, { base = 'HEAD', all = false } = {}) {
  // 即使局部选择，也先核对全部测试唯一归属，拒绝新增未登记、遗漏与重复。
  const inventory = testInventory(root), allFiles = inventory.map(entry => entry.file).sort();
  const commit = git(root, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]);
  const baseFiles = new Set(git(root, ['ls-tree', '-r', '--name-only', '-z', commit]).split('\0').filter(Boolean));
  const paths = [...new Set([...git(root, ['diff', '--no-renames', '--name-only', '-z', commit, '--']).split('\0'), ...git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0')].filter(Boolean))].sort();
  const changes = paths.map(path => ({ path, kind: !baseFiles.has(path) ? 'added' : existsSync(join(root, path)) ? 'modified' : 'deleted' }));
  const dependencies = changes.length && !all ? relatedDependencies(root, commit, baseFiles) : { diagnostics: [], dependents: file => new Set([file]), opaqueTests: [], inputs: [] };
  const selected = new Set(), reasons = [];
  let requiresBuild = all, completeForLocalUi = changes.length > 0 && !all;
  const uiFiles = [...new Set([...strictTestFiles(root, allFiles), ...inventory.filter(entry => /-panel\.test\./.test(entry.file) || extendedTests.includes(entry.file) || entry.scopes.some(scope => ['ui-core', 'ui-extended'].includes(scope))).map(entry => entry.file)])];
  const add = (path, rule, tests, detail) => {
    for (const file of tests) selected.add(file);
    reasons.push({ path, rule, description: descriptions[rule], tests, ...(detail ? { detail } : {}) });
  };
  const expand = (change, rule, detail) => { add(change.path, rule, allFiles, detail); requiresBuild = true; completeForLocalUi = false; };
  for (const change of changes) {
    const path = change.path;
    if (configuration(path)) { expand(change, 'configuration-or-build'); continue; }
    if (path.startsWith('tests/helpers/')) { expand(change, 'shared-helper'); continue; }
    if (/^(?:docs\/templates\/|tests\/fixtures\/)/.test(path)) { expand(change, 'implicit-input'); continue; }
    if (/\.test\.[cm]?[jt]sx?$/.test(path) && change.kind === 'deleted') { expand(change, 'test-removal'); continue; }
    const dependents = dependencies.dependents(path);
    const related = inventory.filter(entry => dependents.has(entry.file)).map(entry => entry.file).sort();
    const opaqueTests = dependencies.opaqueTests.filter(file => allFiles.includes(file));
    if (opaqueTests.length) { add(path, 'opaque-consumers', opaqueTests, dependencies.diagnostics.filter(item => item.consumer)); completeForLocalUi = false; }
    if (dependencies.diagnostics.some(item => item.type === 'unsupported-alias')) { expand(change, 'unknown-dependency', dependencies.diagnostics.filter(item => item.type === 'unsupported-alias')); continue; }
    if (documentation(path)) {
      if (related.length) add(path, 'literal-file-input', related, dependencies.inputs.filter(item => item.input === path));
      else if (!opaqueTests.length) add(path, 'documentation-only', []);
      completeForLocalUi = false; continue;
    }
    if (inventory.some(entry => entry.file === path)) { add(path, 'changed-test', related); completeForLocalUi = false; continue; }
    if (/^src\/(?:shared\/|service\/|mcp\/|runtime\.|server\.|workspace\.)/.test(path)) { expand(change, 'shared-runtime'); continue; }
    const unknown = dependencies.diagnostics.filter(item => item.type === 'parse-error' || (dependents.has(item.file) && item.type === 'unresolved-import'));
    if (unknown.length) { expand(change, 'unknown-dependency', unknown); continue; }
    const opaque = dependencies.diagnostics.filter(item => item.type === 'opaque-input' && dependents.has(item.file) && !item.file.startsWith('tests/'));
    if (opaque.length) { expand(change, 'opaque-input', opaque); continue; }
    if (/^src\/panel\//.test(path)) {
      let before, after;
      if (baseFiles.has(path)) before = git(root, ['show', `${commit}:${path}`]);
      try { after = readFileSync(join(root, path), 'utf8'); } catch { /* 删除时保守扩大。 */ }
      const staticStyle = isStaticStyleChange(path, before, after);
      if (path.endsWith('.css') && !staticStyle) { expand(change, 'css-input-rules'); continue; }
      const mapped = componentTests.filter(mapping => mapping.pattern.test(path)).flatMap(mapping => mapping.tests.map(name => `tests/${name}-panel.test.ts`));
      const theme = /(?:style\.css|components\/ui\/|lib\/utils|\/app\.tsx$)/.test(path);
      const ui = !staticStyle || theme ? uiFiles : [...extendedTests, ...mapped].filter(file => uiFiles.includes(file));
      const tests = [...new Set([...related, ...ui])].sort();
      if (!tests.length) { expand(change, 'conservative-all'); continue; }
      add(path, staticStyle ? 'static-ui-and-component-map' : 'non-style-ui', tests);
      requiresBuild = true; completeForLocalUi &&= staticStyle; continue;
    }
    if ([...dependents].some(file => file.startsWith('src/panel/'))) {
      add(path, 'panel-consumers', [...new Set([...related, ...uiFiles])].sort()); requiresBuild = true; completeForLocalUi = false;
    } else if (related.length) { add(path, 'static-dependents', related); completeForLocalUi = false; }
    else expand(change, 'conservative-all');
  }
  if (all) { add(undefined, 'explicit-all', allFiles); completeForLocalUi = false; }
  const files = [...selected].sort();
  return {
    schemaVersion: 1, kind: 'related-plan', base: { requested: base, commit }, changes,
    status: files.length ? 'ready' : changes.length || all ? 'no-tests-selected' : 'no-changes', selected: files,
    executors: [...new Set(files.map(file => inventory.find(entry => entry.file === file).executor))].map(executor => ({ executor, files: files.filter(file => inventory.find(entry => entry.file === file).executor === executor) })),
    reasons, requiresBuild, completeForLocalUi: files.length > 0 && completeForLocalUi,
    uiFiles: files.filter(file => uiFiles.includes(file)),
    browserRequired: files.some(file => uiFiles.includes(file) && file !== 'tests/style-collisions.test.ts'),
    maxConcurrency: completeForLocalUi && files.every(file => extendedTests.includes(file)) ? 2 : 1, notCovered: allFiles.filter(file => !selected.has(file)),
    completeForFullCheck: false, completeForFormalVerification: false, requiredFollowup: 'full-check-and-verify',
    note: '静态图及显式映射用于保守选测，不能证明所有潜在影响；未覆盖项需完整检查及固定提交验收。',
  };
}
