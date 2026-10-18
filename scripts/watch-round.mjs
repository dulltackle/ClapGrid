import { randomUUID, createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { createRelatedPlan } from './related-plan.mjs';
import { executionIdentity, executionPlan, stagePlan, strictTestFiles, validateExecution } from './test-evidence.mjs';
import { sameSource } from './check-source.mjs';
import { requireChrome } from './check-ui.mjs';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function inChromeEnvironment(command, work) {
  const previous = process.env.CHROME_BIN;
  if (command) process.env.CHROME_BIN = command;
  try { return work(); } finally { if (previous === undefined) delete process.env.CHROME_BIN; else process.env.CHROME_BIN = previous; }
}

/** 预期范围、阶段及所有测试nonce由父拥有者在启动子入口之前独立采集。 */
export function prepareWatchRound(root, directory, roundId, { base, all }) {
  const expected = { directory, roundId, mainId: randomUUID(), recheckIds: {}, strictFiles: [], referenceFiles: [], pendingStages: [], pendingFailures: [], pendingStrictFiles: [] };
  try {
    const path = join(root, 'logs/check-state/failures.json'), original = existsSync(path) ? readFileSync(path) : undefined, manifest = original ? JSON.parse(original.toString('utf8')) : undefined;
    if (original) expected.pendingManifestSha256 = createHash('sha256').update(original).digest('hex');
    if (manifest) { expected.pendingStages = [...manifest.stages]; expected.pendingFailures = [...manifest.failures]; expected.referenceFiles = [...(manifest.referenceFiles ?? [])]; expected.pendingStrictFiles = [...(manifest.strictTestFiles ?? [])]; expected.strictFiles = [...expected.pendingStrictFiles]; }
    expected.plan = createRelatedPlan(root, { base, all });
    expected.strictFiles = [...new Set([...expected.strictFiles, ...strictTestFiles(root, executionPlan(root, { suite: 'all' }).files)])];
    expected.mainStages = expected.plan.status === 'ready' ? ['typecheck', 'test', ...(expected.plan.requiresBuild ? ['build'] : [])].map(name => ({ name, ...(name === 'test' ? { plan: executionPlan(root, { suite: 'all', files: expected.plan.selected }), id: expected.mainId } : {}) })) : [];
    if (manifest) {
      const names = manifest.stages.map(name => name === 'test' ? 'test:failed' : name);
      if (new Set(names).size !== names.length) throw Error('复验阶段重复');
      expected.recheckStages = names.map(name => {
        const plan = stagePlan(root, name, { CLAPGRID_FAILURE_MANIFEST: path });
        if (plan) expected.recheckIds[name] = randomUUID();
        return { name, ...(plan ? { plan, id: expected.recheckIds[name], strictFiles: manifest.strictTestFiles ?? [] } : {}) };
      });
    }
    if (expected.plan.browserRequired || expected.recheckStages?.some(stage => stage.plan && strictTestFiles(root, stage.plan.files).length)) {
      try { expected.browser = requireChrome(); } catch { /* 子单次入口保留实际缺浏览器的失败及待办。 */ }
    }
  } catch (error) { expected.planningError = error.message; }
  expected.identity = inChromeEnvironment(expected.browser?.command, () => executionIdentity(root, expected.mainId));
  return expected;
}

export function validateWatchRound(root, record, result, expected) {
  if (!['passed', 'failed', 'invalidated', 'cancelled', 'no-changes', 'no-tests-selected'].includes(record.status) || !record.completedAt) throw Error('单轮完成记录不完整');
  if (record.watchRoundId !== expected.roundId || record.directory !== expected.directory) throw Error('单轮记录身份或目录不符');
  const exit = { passed: 0, failed: 1, invalidated: 1, cancelled: 130, 'no-changes': 2, 'no-tests-selected': 2 }[record.status];
  if (result.exitCode !== exit) throw Error('子入口退出状态与完成记录不符');
  const complete = ['passed', 'no-changes', 'no-tests-selected'].includes(record.status);
  if (complete && expected.planningError) throw Error(`父拥有者无法确认预期范围：${expected.planningError}`);
  const current = inChromeEnvironment(expected.browser?.command, () => executionIdentity(root, expected.mainId));
  if (!sameSource(current.source, expected.identity.source) || !equal(current.config, expected.identity.config) || !equal(current.environment, expected.identity.environment)
    || !sameSource(record.source, expected.identity.source) || !sameSource(record.sourceAfter, expected.identity.source)) throw Error('父拥有者确认的单轮源码、配置或环境已变化');
  const validateStages = (actual, stages, requireComplete, requirePassed = requireComplete) => {
    if (!Array.isArray(actual) || actual.length > stages.length || requireComplete && actual.length !== stages.length || !equal(actual.map(stage => stage.name), stages.slice(0, actual.length).map(stage => stage.name))) throw Error('单轮实际阶段集合缺失或改变');
    for (const [index, stage] of actual.entries()) {
      const wanted = stages[index];
      if (stage.status !== 'passed') { if (requirePassed) throw Error(`单轮阶段没有实际通过：${wanted.name}`); continue; }
      if (stage.exitCode !== 0) throw Error(`单轮阶段退出状态不符：${wanted.name}`);
      if (!wanted.plan) continue;
      if (stage.testExecutionId !== wanted.id || !equal(stage.testPlan, wanted.plan)) throw Error('单轮实际测试nonce或范围不符');
      if (typeof stage.testReport !== 'string' || !resolve(stage.testReport).startsWith(resolve(expected.directory) + sep)) throw Error('单轮测试来源越界或缺失');
      const report = read(stage.testReport);
      validateExecution(root, report, wanted.plan, { ...expected.identity, executionId: wanted.id }, { strictFiles: wanted.strictFiles ?? expected.plan.uiFiles });
      if (wanted.name === 'test' && !equal(record.actual, report.actual)) throw Error('单轮实际集合摘要与原始执行不符');
    }
  };
  validateStages(record.results, expected.mainStages ?? [], complete);
  if (expected.recheckStages) {
    if (!record.recheck) throw Error('缺少本轮应有的集中复验，不能清待办');
    validateStages(record.recheck.results, expected.recheckStages, true, complete || record.recheck.status === 'passed');
    if (complete && record.recheck?.status !== 'passed') throw Error('本轮集中复验未通过');
  } else if (record.recheck) throw Error('单轮出现父预期以外的复验来源');
  if (complete) {
    const state = expected.plan.status === 'ready' ? 'passed' : expected.plan.status;
    if (record.status !== state || !equal(record.expected?.files, expected.plan.selected)) throw Error('单轮结论或选中集合与父预期不符');
  }
}
