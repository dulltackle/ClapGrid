import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import * as checks from './check-runner.mjs';
import { withCheckRun, atomicJson, stateDirectory } from './check-lifecycle.mjs';
import { sameSource, sourceIdentity } from './check-source.mjs';
import { executionPlan, executionIdentity, validateExecution } from './test-evidence.mjs';
import { requireChrome } from './check-ui.mjs';
import { createRelatedPlan } from './related-plan.mjs';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** 单次运行接口可供后续显式watch调用；本入口不保存历史通过资格。 */
export async function checkRelated(root, options = {}) {
  const started = performance.now();
  const summary = await withCheckRun(root, 'related-development', context => executeRelated(root, options, context), { signal: options.signal });
  summary.lifecycleCompletedAt = new Date().toISOString(); summary.totalMs = performance.now() - started;
  atomicJson(join(summary.directory, 'summary.json'), summary);
  return summary;
}

async function executeRelated(root, { base = 'HEAD', all = false, concurrency = 2, directory = join(root, 'logs/check-related', `${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`) }, context) {
  mkdirSync(directory, { recursive: true }); context.recordLog(directory);
  const summary = { schemaVersion: 1, mode: 'related-development', directory, startedAt: new Date().toISOString(), source: sourceIdentity(root), status: 'running', relatedFeedback: 'not-run', uiLocalFeedback: 'not-certified', completeForLocalUi: false, completeForFullCheck: false, completeForFormalVerification: false, strictTestFiles: [], results: [], failures: [], expected: { files: [] }, actual: { files: [], cases: [] }, pending: [], note: '相关测试反馈仅证明本次选中范围；完整开发检查及固定提交正式验收仍必需。阶段指纹能发现变化，不证明期间从未修改后恢复。' };
  if (process.env.CLAPGRID_RELATED_ROUND_ID) summary.watchRoundId = process.env.CLAPGRID_RELATED_ROUND_ID;
  const save = () => { summary.heartbeatAt = new Date().toISOString(); atomicJson(join(directory, 'summary.json'), summary); };
  const previousChrome = process.env.CHROME_BIN;
  checks.checkProgress(`日常检查日志：${directory}`); save();
  let boundMainId;
  try {
    if (![1, 2].includes(Number(concurrency))) throw Error('--concurrency 仅支持 1 或 2');
    let recheckContext = context;
    if (process.env.CLAPGRID_RELATED_ROUND_ID) {
      boundMainId = process.env.CLAPGRID_RELATED_TEST_EXECUTION_ID;
      const ids = JSON.parse(process.env.CLAPGRID_RELATED_RECHECK_IDS ?? '{}'), values = [boundMainId, ...Object.values(ids)];
      if (values.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) || new Set(values.map(id => id.toLowerCase())).size !== values.length) throw Error('watch父拥有者须提供独立合法测试nonce');
      recheckContext = { ...context, testExecutionId(name) { if (!ids[name]) throw Error(`父拥有者未分配复验nonce：${name}`); return ids[name]; } };
    }
    if (existsSync(join(stateDirectory(root), 'failures.json'))) {
      // 失败政策由公共runner维护；后续独立运行不取得旧run的累计资格。
      summary.recheck = await checks.recheckFailures(root, join(directory, 'recheck'), recheckContext);
      if (summary.recheck && summary.recheck.status !== 'passed') { summary.status = summary.recheck.status; summary.blocked = true; return summary; }
    }
    summary.sourceAfter = sourceIdentity(root);
    if (!sameSource(summary.source, summary.sourceAfter)) { summary.status = 'invalidated'; return summary; }
    summary.plan = createRelatedPlan(root, { base, all });
    summary.expected.files = summary.plan.selected; summary.strictTestFiles = summary.plan.uiFiles;
    summary.sourceAfter = sourceIdentity(root);
    if (!sameSource(summary.source, summary.sourceAfter)) { summary.status = 'invalidated'; return summary; }
    checks.checkProgress(`变更基准：${base} → ${summary.plan.base.commit}`);
    checks.checkProgress(`变化文件：${summary.plan.changes.map(change => `${change.kind}:${change.path}`).join(', ') || '无'}`);
    for (const reason of summary.plan.reasons) checks.checkProgress(`选择依据 ${reason.path ?? '--all'}：${reason.rule}；${reason.description}`);
    checks.checkProgress(`预期测试：${summary.plan.selected.join(', ') || '无'}；未覆盖：${summary.plan.notCovered.join(', ') || '无（仍不等于完整验收）'}`);
    if (summary.plan.status !== 'ready') { summary.status = summary.plan.status; return summary; }
    summary.requestedConcurrency = Number(concurrency); summary.effectiveConcurrency = Math.min(Number(concurrency), summary.plan.maxConcurrency);
    const stages = ['typecheck', 'test', ...(summary.plan.requiresBuild ? ['build'] : [])]; summary.pending = [...stages]; save();
    for (const name of stages) {
      if (context.signal.aborted) { summary.status = 'cancelled'; break; }
      summary.phase = name; const startedAt = new Date().toISOString();
      const log = join(directory, `${name}.log`), testReport = join(directory, 'tests.json');
      let result, identity, testPlan;
      const testExecutionId = name === 'test' ? boundMainId ?? randomUUID() : undefined;
      try {
        if (name === 'test') {
          testPlan = executionPlan(root, { suite: 'all', files: summary.plan.selected });
          if (summary.plan.browserRequired) { summary.browser = requireChrome(); process.env.CHROME_BIN = summary.browser.command; }
          identity = executionIdentity(root, testExecutionId);
          result = await checks.runLogged(process.execPath, [join(root, 'scripts/test-runner.mjs'), '--suite', 'all', '--files', JSON.stringify(testPlan.files), '--concurrency', String(summary.effectiveConcurrency)], root, log, context,
            { CLAPGRID_TEST_EXECUTION_ID: testExecutionId, CLAPGRID_TEST_REPORT: testReport, CLAPGRID_TEST_CONCURRENCY: String(summary.effectiveConcurrency), CLAPGRID_BROWSER_TIMINGS: join(directory, 'browser-timings.jsonl'), ...(summary.browser ? { CHROME_BIN: summary.browser.command } : {}) });
          if (result.status !== 'cancelled') {
            result.testReport = testReport;
            try {
              const report = read(testReport);
              summary.actual = report.actual ?? { files: [], cases: [] };
              summary.testTotals = report.summary?.counts;
              summary.failures.push(...(report.failures ?? []));
              validateExecution(root, report, testPlan, identity, { checkSource: true });
              if (report.status !== 'passed') throw Error('统一测试报告未通过');
              const skippedUi = report.actual.cases.filter(item => summary.plan.uiFiles.includes(item.file) && item.status !== 'passed');
              if (skippedUi.length) { summary.failures.push(...skippedUi.map(item => ({ ...item, message: 'UI场景必须实际通过' }))); throw Error('UI测试跳过或todo不能通过'); }
            } catch (error) { result.status = 'failed'; result.error = `测试事件证据无效：${error.message}`; }
            if (result.status === 'failed' && !summary.failures.length) summary.failures.push({ name: result.error ?? '测试执行失败，位置未知' });
          }
        } else result = await checks.runLogged(npm, ['run', name], root, log, context);
      } catch (error) { result = { status: context.signal.aborted ? 'cancelled' : 'failed', error: error.message }; if (name === 'test') summary.failures.push({ name: error.message }); }
      summary.results.push({ name, ...result, log, startedAt, completedAt: new Date().toISOString(), ...(testExecutionId ? { testExecutionId, testPlan, strictTestFiles: summary.strictTestFiles } : {}) });
      summary.pending = stages.filter(stage => !summary.results.some(item => item.name === stage && item.status !== 'cancelled'));
      summary.sourceAfter = sourceIdentity(root); save();
      if (result.status === 'cancelled') { summary.status = 'cancelled'; break; }
      if (!sameSource(summary.source, summary.sourceAfter)) { summary.status = 'invalidated'; break; }
      if (result.status !== 'passed') { summary.status = 'failed'; break; }
    }
    if (summary.status === 'running') {
      summary.status = 'passed'; summary.relatedFeedback = 'passed';
      summary.completeForLocalUi = summary.plan.completeForLocalUi;
      summary.uiLocalFeedback = summary.completeForLocalUi ? 'passed' : 'not-certified';
    }
  } catch (error) { summary.status = context.signal.aborted ? 'cancelled' : 'failed'; summary.error = error.message; }
  finally {
    if (previousChrome === undefined) delete process.env.CHROME_BIN; else process.env.CHROME_BIN = previousChrome;
    summary.sourceAfter = sourceIdentity(root);
    if (summary.status !== 'cancelled' && !sameSource(summary.source, summary.sourceAfter)) {
      summary.status = 'invalidated'; summary.relatedFeedback = summary.results.some(stage => stage.name === 'test') ? 'invalidated' : 'not-run';
      summary.completeForLocalUi = false;
    }
    if (summary.status !== 'passed' && summary.results.some(stage => stage.name === 'test')) {
      summary.relatedFeedback = summary.status;
      if (summary.plan?.uiFiles.length) summary.uiLocalFeedback = summary.status;
    }
    summary.completedAt = new Date().toISOString(); checks.recordCheckFailures(context, summary); save();
  }
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { base: { type: 'string', default: 'HEAD' }, all: { type: 'boolean', default: false }, plan: { type: 'boolean', default: false }, watch: { type: 'boolean', default: false }, concurrency: { type: 'string', default: '2' } } });
    if (!['1', '2'].includes(values.concurrency)) throw Error('--concurrency 仅支持 1 或 2');
    const root = fileURLToPath(new URL('../', import.meta.url));
    if (values.watch) {
      if (values.plan) throw Error('--watch 不与 --plan 同用');
      const summary = await (await import('./check-watch.mjs')).watchRelated(root, values);
      process.exitCode = summary.state === 'cancelled' ? 130 : 1;
    } else if (values.plan) {
      const source = sourceIdentity(root), plan = createRelatedPlan(root, values), sourceAfter = sourceIdentity(root);
      if (!sameSource(source, sourceAfter)) throw Error('计划期间源码变化，选择已失效');
      console.log(JSON.stringify({ ...plan, source, sourceAfter, planOnly: true }, null, 2));
    } else {
      const summary = await checkRelated(root, { ...values, ...(process.env.CLAPGRID_RELATED_DIRECTORY ? { directory: process.env.CLAPGRID_RELATED_DIRECTORY } : {}) });
      checks.checkProgress(`实际测试：${summary.actual.files.map(item => item.file).join(', ') || '无'}；日常反馈：${summary.status}；UI本地反馈：${summary.uiLocalFeedback}；完整检查/正式验收：未完成；总耗时：${summary.totalMs.toFixed(1)}ms`);
      process.exitCode = summary.status === 'passed' ? 0 : summary.status === 'cancelled' ? 130 : ['no-changes', 'no-tests-selected'].includes(summary.status) ? 2 : 1;
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
