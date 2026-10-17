import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { sourceIdentity, sameSource } from './check-source.mjs';
import { normalizeNative as vitestNative } from './vitest-evidence.mjs';

export const inventoryPath = 'scripts/test-inventory.json';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
export const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const equalSet = (a, b) => a.length === b.length && [...a].sort().every((value, i) => value === [...b].sort()[i]);
export const relativeFile = (root, file) => relative(root, resolve(root, file)).replaceAll('\\', '/');

/** 清单是执行者所有权；scope 可以重叠，文件所有权不能重叠。 */
export function testInventory(root) {
  const inventory = read(join(root, inventoryPath));
  if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.files)) throw Error('测试执行清单格式不受支持');
  const found = readdirSync(join(root, 'tests'), { recursive: true }).filter(file => /\.test\.[cm]?[jt]sx?$/.test(String(file))).map(file => `tests/${String(file).replaceAll('\\', '/')}`).sort();
  const references = inventory.references ?? [];
  const nativeFiles = readdirSync(join(root, 'tests'), { recursive: true }).filter(file => /\.native\.ts$/.test(String(file))).map(file => `tests/${String(file).replaceAll('\\', '/')}`);
  if (!equalSet(references.map(entry => entry.file), nativeFiles) || new Set(references.map(entry => entry.file)).size !== references.length) throw Error('原生对照文件未登记、丢失或重复归属');
  for (const entry of references) if (entry.executor !== 'node' || !entry.scopes?.includes('comparison-only')) throw Error('原生对照执行者或范围无效');
  if (references.length) {
    const baseline = read(join(root, 'scripts/test-pilot-baseline.json'));
    if (!equalSet(baseline.snapshots.map(item => item.file), nativeFiles) || baseline.snapshots.some(item => digest(join(root, item.file)) !== item.sha256)) throw Error('原生试点快照已变化；须明确重新建立行为基准');
  }
  const files = inventory.files.map(entry => entry.file);
  if (new Set(files).size !== files.length) throw Error('测试文件重复归属');
  if (!equalSet(files, found)) throw Error(`测试执行清单与源码不符：未登记 ${found.filter(file => !files.includes(file)).join(', ')}；已丢失 ${files.filter(file => !found.includes(file)).join(', ')}`);
  for (const entry of inventory.files) {
    if (!/^tests\/(?!.*(?:^|\/)\.\.\/)[\w./-]+\.test\.[cm]?[jt]sx?$/.test(entry.file) || !['node', 'vitest', 'playwright'].includes(entry.executor) || !Array.isArray(entry.scopes) || !entry.scopes.includes('all') || new Set(entry.scopes).size !== entry.scopes.length) throw Error(`测试执行者或范围无效：${entry.file}`);
  }
  return inventory.files;
}

export function ownedTests(root) {
  const files = testInventory(root);
  return [...files, ...(read(join(root, inventoryPath)).references ?? [])];
}

/** 未知失败扩大完整集合，仍保留已知对照；任何已知越界/缺失先拒绝。 */
export function failureFiles(root, failures, { referenceFiles = [] } = {}) {
  const owned = existsSync(join(root, inventoryPath)) ? ownedTests(root) : null;
  let unknown = false;
  const validate = input => {
    const file = relativeFile(root, input);
    const allowed = owned ? owned.some(entry => entry.file === file) : /^tests\/(?!.*(?:^|\/)\.\.\/)[\w./-]+\.test\.[cm]?[jt]sx?$/.test(file);
    if (!file || !allowed || !existsSync(resolve(root, file))) throw Error(`无法定位待复验测试文件：${input}`);
    return file;
  };
  const files = [...new Set(failures.flatMap(item => {
    if (!item.file) { unknown = true; return []; }
    return [validate(item.file)];
  }))];
  const references = [...new Set(referenceFiles.map(validate))];
  if (references.some(file => !owned?.some(entry => entry.file === file && entry.scopes.includes('comparison-only')))) throw Error('原生待复验范围归属无效');
  const retained = [...new Set([...references, ...files.filter(file => owned?.some(entry => entry.file === file && entry.scopes.includes('comparison-only')))])];
  if (unknown) return retained.length ? [...new Set([...owned.filter(entry => entry.scopes.includes('all')).map(entry => entry.file), ...retained])] : [];
  return [...new Set([...files, ...references])];
}

export function executionPlan(root, { suite = 'all', files, executor } = {}) {
  const all = testInventory(root);
  const nativeGroup = suite.startsWith('native-') ? suite.slice(7) : null;
  const inventory = nativeGroup ? read(join(root, inventoryPath)).references.filter(entry => entry.group === nativeGroup) : suite === 'failed' ? ownedTests(root) : all;
  const selected = files ? files.map(file => relativeFile(root, file)) : inventory.filter(entry => (nativeGroup || entry.scopes.includes(suite)) && (!executor || entry.executor === executor)).map(entry => entry.file);
  if (!selected.length || new Set(selected).size !== selected.length) throw Error('测试范围为空或重复');
  executor ??= [...new Set(selected.map(file => inventory.find(entry => entry.file === file)?.executor))].length === 1 ? inventory.find(entry => entry.file === selected[0])?.executor : 'mixed';
  for (const file of selected) if (!inventory.some(entry => entry.file === file && (executor === 'mixed' || entry.executor === executor))) throw Error(`测试执行者或范围不符：${file}`);
  return { schemaVersion: 1, suite, executor, files: selected.sort(), inventory: digest(join(root, inventoryPath)) };
}

export function executionIdentity(root, executionId = process.env.CLAPGRID_TEST_EXECUTION_ID) {
  const inputs = ['package.json', 'package-lock.json', inventoryPath, 'scripts/test-runner.mjs', 'scripts/test-reporter.mjs', 'scripts/test-evidence.mjs', 'scripts/vitest-runner.mjs', 'scripts/vitest-reporter.mjs', 'scripts/vitest-evidence.mjs', 'vitest.config.ts'];
  return { executionId, source: sourceIdentity(root), config: inputs.map(file => [file, existsSync(join(root, file)) ? digest(join(root, file)) : null]), environment: { node: process.version, platform: process.platform, arch: process.arch, chrome: process.env.CHROME_BIN ?? null, nodeOptions: process.env.NODE_OPTIONS ?? null } };
}
const caseKey = item => JSON.stringify([item.file, item.name, item.nesting, item.line, item.column]);
const sameIdentity = (a, b) => a.executionId === b.executionId && sameSource(a.source, b.source) && JSON.stringify(a.config) === JSON.stringify(b.config) && JSON.stringify(a.environment) === JSON.stringify(b.environment);
const portable = (root, item) => ({ ...item, ...(item.file ? { file: relativeFile(root, item.file) } : {}) });

/** 执行者适配层只解释报告；是否完整由同一校验器判断。 */
const normalizeNative = (root, native, executor) => executor === 'vitest' ? vitestNative(root, native) : native;

export function executorEvidence(root, plan, nativePath, identity, { strict = false, logPath, additionalSources = [] } = {}) {
  const native = normalizeNative(root, read(nativePath), plan.executor);
  const report = { schemaVersion: 2, kind: 'test-execution', executor: native.executor, plan, identity, identityAfter: executionIdentity(root, identity.executionId),
    startedAt: native.startedAt, completedAt: native.completedAt, complete: native.complete,
    expected: { files: plan.files, cases: (native.expectedCases ?? []).map(item => portable(root, item)), caseDiscovery: plan.executor === 'node' ? 'native test:enqueue events' : 'Vitest onTestModuleCollected events' },
    actual: { files: (native.files ?? []).map(item => portable(root, item)), cases: (native.cases ?? []).map(item => portable(root, item)) },
    failures: (native.failures ?? []).map(item => portable(root, item)), errors: native.errors ?? [], summary: native.summary,
    policy: { strict }, sources: { native: { path: nativePath, sha256: digest(nativePath) }, ...(logPath ? { log: { path: logPath, sha256: digest(logPath) } } : {}), ...(additionalSources.length ? { additional: additionalSources.map(path => ({ path, sha256: digest(path) })) } : {}) } };
  // identityAfter 刚在本次同步构造中采集；仅读原始报告/写忽略日志，不重复扫描同一边界。
  try { validateExecution(root, report, plan, identity); report.status = 'passed'; }
  catch (error) { report.status = 'failed'; report.validationError = error.message; }
  return report;
}

export const nodeEvidence = executorEvidence;

/** 在开发检查、固定提交验收和历史复用时执行相同完整性检查。 */
export function validateExecution(root, report, plan, identity, { checkSource = false } = {}) {
  if (plan.executor === 'mixed') return validateAggregate(root, report, plan, identity, { checkSource });
  if (report.schemaVersion !== 2 || report.kind !== 'test-execution' || !report.complete || report.errors?.length || report.failures?.length) throw Error('测试证据不完整或包含失败/未捕获错误');
  if (report.executor?.name !== plan.executor || !report.executor.version || (plan.executor === 'node' && report.executor.version !== process.version)) throw Error('测试执行者身份不符');
  const dependency = plan.executor === 'vitest' ? 'vitest' : plan.executor === 'playwright' ? '@playwright/test' : null;
  if (dependency && report.executor.version !== read(join(root, 'node_modules', dependency, 'package.json')).version) throw Error('测试执行者版本与实际安装不符');
  if (!identity.executionId || JSON.stringify(report.plan) !== JSON.stringify(plan) || !sameIdentity(report.identity, identity) || !sameIdentity(report.identityAfter, identity) || (checkSource && !sameIdentity(executionIdentity(root, identity.executionId), identity))) throw Error('测试源码、配置、环境或执行范围身份不符');
  if (!report.startedAt || !report.completedAt || !(Date.parse(report.startedAt) <= Date.parse(report.completedAt))) throw Error('测试起止时间缺失或无效');
  const files = report.actual?.files ?? [], cases = report.actual?.cases ?? [], expected = report.expected;
  if (!equalSet(expected?.files ?? [], plan.files) || !equalSet(files.map(item => item.file), plan.files) || files.some(item => item.status !== 'passed')) throw Error('测试实际文件集合不完整或含失败');
  if (!cases.length || !equalSet((expected?.cases ?? []).map(caseKey), cases.map(caseKey)) || cases.some(item => !plan.files.includes(item.file) || !['passed', 'skipped', 'todo'].includes(item.status))) throw Error('测试用例收集或执行不完整');
  if (plan.files.some(file => !cases.some(item => item.file === file))) throw Error('测试文件未收集任何用例');
  const counts = report.summary?.counts;
  if (!report.summary?.success || !counts || counts.failed !== 0 || counts.cancelled !== 0 || counts.tests + counts.suites !== cases.length || counts.passed + counts.skipped + counts.todo !== counts.tests) throw Error('测试原生汇总与逐项执行不符');
  if (report.policy?.strict && cases.some(item => item.status !== 'passed')) throw Error('UI 测试跳过或 todo 不能通过');
  const source = report.sources?.native;
  if (!source || digest(source.path) !== source.sha256) throw Error('测试原生证据缺失或改变');
  if (report.sources.log && digest(report.sources.log.path) !== report.sources.log.sha256) throw Error('测试原始日志缺失或改变');
  for (const artifact of report.sources.additional ?? []) if (digest(artifact.path) !== artifact.sha256) throw Error('测试补充原始报告缺失或改变');
  const native = normalizeNative(root, read(source.path), plan.executor);
  if (JSON.stringify(native.cases.map(item => portable(root, item))) !== JSON.stringify(cases) || JSON.stringify(native.files.map(item => portable(root, item))) !== JSON.stringify(files)
    || JSON.stringify(native.expectedCases.map(item => portable(root, item))) !== JSON.stringify(expected.cases)
    || JSON.stringify(native.summary) !== JSON.stringify(report.summary) || JSON.stringify(native.failures.map(item => portable(root, item))) !== JSON.stringify(report.failures)
    || native.executionId !== identity.executionId || native.startedAt !== report.startedAt || native.completedAt !== report.completedAt
    || !native.complete || native.errors.length || JSON.stringify(native.executor) !== JSON.stringify(report.executor)) throw Error('统一证据与原始报告不符');
  return true;
}

export function stagePlan(root, name, env = {}) {
  const suites = { test: 'all', 'test:tooling': 'tooling', 'test:rows': 'rows', 'test:failed': 'all' };
  if (!(name in suites)) return null;
  let files;
  if (name === 'test:failed') {
    const manifest = read(env.CLAPGRID_FAILURE_MANIFEST ?? join(root, 'logs/check-state/failures.json'));
    const failed = failureFiles(root, manifest.failures ?? [], { referenceFiles: manifest.referenceFiles ?? [] });
    files = failed.length ? failed : testInventory(root).map(entry => entry.file);
  }
  return executionPlan(root, { suite: name === 'test:failed' ? 'failed' : suites[name], ...(files ? { files } : name === 'test:failed' ? { files: testInventory(root).map(entry => entry.file) } : {}) });
}

export function validateCheckEvidence(root, check, source) {
  const pkg = read(join(root, 'package.json'));
  for (const [phase, required] of [[check.preflight, pkg.checkPreflight ?? ['typecheck']], [check, ['typecheck', 'test', 'build']]]) {
    if (!Array.isArray(phase?.results) || !equalSet(phase.results.map(result => result.name), required)) throw Error('检查阶段集合不完整或重复');
    if (!phase || phase.status !== 'passed' || phase.pending?.length || !sameSource(phase.source, source) || !sameSource(phase.sourceAfter, source)) throw Error('检查阶段证据缺失或源码不符');
    for (const result of phase.results) {
      const plan = stagePlan(root, result.name);
      if (!result.log || !existsSync(result.log) || result.status !== 'passed' || result.exitCode !== 0) throw Error('阶段日志缺失或未通过');
      if (!plan) continue;
      if (!result.testReport) throw Error('测试报告缺失');
      const report = read(result.testReport);
      const identity = executionIdentity(root, result.testExecutionId);
      validateExecution(root, report, plan, identity, { checkSource: true });
      if (report.status !== 'passed') throw Error('测试统一报告未通过');
    }
  }
  return true;
}

export function aggregateEvidence(root, plan, paths, identity) {
  const executions = paths.map(path => read(path));
  const merge = key => executions.flatMap(report => report[key] ?? []);
  const cases = executions.flatMap(report => report.actual.cases), files = executions.flatMap(report => report.actual.files);
  const counts = { tests: 0, suites: 0, passed: 0, failed: 0, skipped: 0, todo: 0, cancelled: 0 };
  for (const report of executions) for (const key of Object.keys(counts)) counts[key] += report.summary?.counts?.[key] ?? 0;
  const report = { schemaVersion: 2, kind: 'test-aggregate', executor: { name: 'mixed', version: '1' }, plan, identity, identityAfter: executions.at(-1)?.identityAfter,
    startedAt: executions[0]?.startedAt, completedAt: executions.at(-1)?.completedAt, complete: executions.every(report => report.complete), executions,
    expected: { files: plan.files, cases: executions.flatMap(report => report.expected.cases), caseDiscovery: '各执行者原生收集事件并集' }, actual: { files, cases },
    failures: merge('failures'), errors: merge('errors'), summary: { success: executions.every(report => report.status === 'passed'), counts },
    sources: { executions: paths.map(path => ({ path, sha256: digest(path) })) } };
  // 末个子执行提供本次真实 after；聚合只读取报告和忽略日志，保留各子执行的完整核对。
  try { validateExecution(root, report, plan, identity); report.status = 'passed'; }
  catch (error) { report.status = 'failed'; report.validationError = error.message; }
  return report;
}
function validateAggregate(root, report, plan, identity, options) {
  if (report.schemaVersion !== 2 || report.kind !== 'test-aggregate' || !report.complete || !report.summary?.success || report.failures?.length || report.errors?.length
    || JSON.stringify(report.plan) !== JSON.stringify(plan) || !sameIdentity(report.identity, identity) || !sameIdentity(report.identityAfter, identity)
    || (options.checkSource && !sameIdentity(executionIdentity(root, identity.executionId), identity))) throw Error('聚合测试证据不完整或身份不符');
  if (!report.executions?.length || report.executions.length !== report.sources?.executions?.length) throw Error('聚合缺少执行者证据');
  const seen = [];
  report.executions.forEach((execution, index) => {
    const source = report.sources.executions[index];
    if (digest(source.path) !== source.sha256 || JSON.stringify(read(source.path)) !== JSON.stringify(execution)) throw Error('聚合子报告来源不符');
    const childPlan = executionPlan(root, { suite: plan.suite, files: execution.plan.files, executor: execution.executor.name });
    validateExecution(root, execution, childPlan, identity, options);
    if (execution.status !== 'passed') throw Error('聚合包含失败子执行');
    seen.push(...execution.actual.files.map(item => item.file));
  });
  if (new Set(seen).size !== seen.length || !equalSet(seen, plan.files) || !equalSet(report.expected.files, plan.files)
    || JSON.stringify(report.actual.files) !== JSON.stringify(report.executions.flatMap(item => item.actual.files))
    || JSON.stringify(report.actual.cases) !== JSON.stringify(report.executions.flatMap(item => item.actual.cases))
    || JSON.stringify(report.expected.cases) !== JSON.stringify(report.executions.flatMap(item => item.expected.cases))) throw Error('聚合测试范围遗漏、重复或逐项不符');
  if (report.startedAt !== report.executions[0].startedAt || report.completedAt !== report.executions.at(-1).completedAt || report.executor?.name !== 'mixed' || report.executor.version !== '1') throw Error('聚合执行者或起止时间不符');
  const counts = Object.fromEntries(['tests', 'suites', 'passed', 'failed', 'skipped', 'todo', 'cancelled'].map(key => [key, report.executions.reduce((sum, item) => sum + item.summary.counts[key], 0)]));
  if (JSON.stringify(counts) !== JSON.stringify(report.summary.counts)) throw Error('聚合计数不符');
  return true;
}
