import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runLogged, checkProgress, recordCheckFailures } from './check-runner.mjs';
import { withCheckRun, atomicJson } from './check-lifecycle.mjs';
import { sameSource, sourceIdentity } from './check-source.mjs';
import { executionPlan, executionIdentity, nodeEvidence, validateExecution } from './test-evidence.mjs';
import { createUiPlan } from './ui-check-plan.mjs';

export function requireChrome(env = process.env) {
  const candidates = env.CHROME_BIN ? [env.CHROME_BIN] : ['google-chrome', 'chromium', 'chromium-browser'];
  for (const command of candidates) {
    try { return { command, version: execFileSync(command, ['--version'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }; } catch { /* 尝试已知浏览器入口。 */ }
  }
  throw Error('UI 快检需要真实 Chrome/Chromium；缺失浏览器不能跳过或记为通过。');
}

export async function checkUi(root, options = {}) {
  const started = performance.now();
  const summary = await withCheckRun(root, 'ui-development', context => executeUi(root, options, context), { signal: options.signal });
  summary.lifecycleCompletedAt = new Date().toISOString();
  summary.totalMs = performance.now() - started;
  atomicJson(join(summary.directory, 'summary.json'), summary);
  return summary;
}

async function executeUi(root, { base = 'HEAD', scope = 'extended', concurrency = 2, native = false, directory = join(root, 'logs/check-ui', `${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`) }, context) {
  mkdirSync(directory, { recursive: true });
  const summary = { mode: 'ui-development', directory, startedAt: new Date().toISOString(), source: sourceIdentity(root), status: 'running', completeForLocalUi: false, results: [], failures: [], note: 'UI 快检不是正式验收；保留完整 check、固定提交 verify 和实际宿主验收。' };
  const save = () => { summary.heartbeatAt = new Date().toISOString(); atomicJson(join(directory, 'summary.json'), summary); };
  context.recordLog(directory);
  checkProgress(`UI 快检日志：${directory}`); save();
  const previous = { chrome: process.env.CHROME_BIN, timings: process.env.CLAPGRID_BROWSER_TIMINGS, context: process.env.NODE_TEST_CONTEXT };
  try {
    if (![1, 2].includes(Number(concurrency))) throw Error('--concurrency 仅支持 1 或 2');
    summary.plan = createUiPlan(root, { base, scope });
    summary.requestedConcurrency = Number(concurrency);
    summary.effectiveConcurrency = Math.min(Number(concurrency), summary.plan.maxConcurrency);
    summary.browser = requireChrome();
    process.env.CHROME_BIN = summary.browser.command;
    process.env.CLAPGRID_BROWSER_TIMINGS = join(directory, 'browser-timings.jsonl');
    delete process.env.NODE_TEST_CONTEXT;
    save();
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const testReport = join(directory, 'ui-tests.json');
    const nativeReport = join(directory, 'ui-tests-native.json');
    const testPlan = executionPlan(root, native ? { suite: 'native-ui' } : { suite: 'ui', files: summary.plan.tests });
    summary.comparisonOnly = native;
    if (native) summary.plan.tests = testPlan.files;
    const dispatch = testPlan.executor !== 'node';
    const stages = [
      { name: 'typecheck', args: ['run', 'typecheck'] },
      { name: 'ui-tests', command: dispatch ? process.execPath : npm, args: dispatch ? [fileURLToPath(new URL('./test-runner.mjs', import.meta.url)), '--files', JSON.stringify(testPlan.files), '--suite', 'ui', '--concurrency', String(summary.effectiveConcurrency)] : ['exec', '--', 'tsx', '--test', `--test-concurrency=${summary.effectiveConcurrency}`,
        '--test-reporter=tap', '--test-reporter-destination=stdout', `--test-reporter=${fileURLToPath(new URL('./test-reporter.mjs', import.meta.url))}`, `--test-reporter-destination=${nativeReport}`, ...summary.plan.tests] },
      { name: 'build', args: ['run', 'build'] },
    ];
    for (const stage of stages) {
      summary.phase = stage.name; save();
      const testExecutionId = stage.name === 'ui-tests' ? randomUUID() : undefined;
      const identity = testExecutionId ? executionIdentity(root, testExecutionId) : null;
      const startedAt = new Date().toISOString();
      const result = await runLogged(stage.command ?? npm, stage.args, root, join(directory, `${stage.name}.log`), context, { CHROME_BIN: summary.browser.command, CLAPGRID_BROWSER_TIMINGS: process.env.CLAPGRID_BROWSER_TIMINGS, ...(testExecutionId ? { CLAPGRID_TEST_EXECUTION_ID: testExecutionId, CLAPGRID_TEST_REPORT: testReport, CLAPGRID_TEST_CONCURRENCY: String(summary.effectiveConcurrency) } : {}) });
      if (result.status === 'cancelled') { summary.results.push({ name: stage.name, ...result, ...(testExecutionId ? { testExecutionId, testPlan } : {}), startedAt, completedAt: new Date().toISOString() }); summary.status = 'cancelled'; break; }
      if (stage.name === 'ui-tests') {
        try {
          const report = dispatch ? JSON.parse(readFileSync(testReport, 'utf8')) : nodeEvidence(root, testPlan, nativeReport, identity, { strict: true, logPath: join(directory, 'ui-tests.log') });
          writeFileSync(testReport, JSON.stringify(report, null, 2) + '\n');
          result.testReport = testReport;
          summary.failures = [...report.failures, ...(report.actual?.cases ?? []).filter(item => item.status !== 'passed').map(item => ({ file: item.file, name: item.name, status: item.status, message: 'UI 场景必须实际通过' }))];
          const counts = report.summary?.counts ?? {};
          summary.testTotals = { tests: counts.tests, passed: counts.passed, failed: counts.failed, skipped: counts.skipped, cancelled: counts.cancelled, todo: counts.todo };
          validateExecution(root, report, testPlan, identity, { checkSource: true, strict: true });
        } catch (error) { result.status = 'failed'; result.error = `无法读取 UI 测试事件报告：${error.message}`; if (!summary.failures.length) summary.failures.push({ name: result.error }); }
      }
      summary.results.push({ name: stage.name, ...result, ...(testExecutionId ? { testExecutionId, testPlan } : {}), startedAt, completedAt: new Date().toISOString() });
      summary.sourceAfter = sourceIdentity(root);
      if (!sameSource(summary.source, summary.sourceAfter)) { summary.status = 'invalidated'; break; }
      save();
      if (result.status !== 'passed') { summary.status = 'failed'; break; }
    }
    if (summary.status === 'running') {
      summary.completeForLocalUi = summary.plan.requiredFollowup === null;
      summary.status = summary.completeForLocalUi ? 'passed' : 'requires-full-check';
    }
  } catch (error) { summary.status = context.signal.aborted ? 'cancelled' : 'failed'; summary.error = String(error); }
  finally {
    for (const [name, value] of [['CHROME_BIN', previous.chrome], ['CLAPGRID_BROWSER_TIMINGS', previous.timings], ['NODE_TEST_CONTEXT', previous.context]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
  summary.completedAt = new Date().toISOString(); recordCheckFailures(context, summary); save(); return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { base: { type: 'string', default: 'HEAD' }, scope: { type: 'string', default: 'extended' }, concurrency: { type: 'string', default: '2' }, native: { type: 'boolean', default: false }, plan: { type: 'boolean', default: false } } });
  const root = fileURLToPath(new URL('../', import.meta.url));
  if (values.plan) console.log(JSON.stringify(createUiPlan(root, values), null, 2));
  else {
    const result = await checkUi(root, values); console.log(`UI 快检结果：${result.status}`);
    process.exitCode = result.status === 'passed' ? 0 : result.status === 'requires-full-check' ? 2 : result.status === 'cancelled' ? 130 : 1;
  }
}
