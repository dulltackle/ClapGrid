import { resolve, relative } from 'node:path';

/** 原始来源是 Playwright 官方 JSON；不从统一记录反推测试完成情况。 */
export function normalizeNative(root, native) {
  if (!native.config?.version || !Array.isArray(native.suites) || !native.stats?.startTime || !Array.isArray(native.errors)) throw Error('Playwright 原生 JSON 缺失或格式无效');
  const portable = file => relative(root, resolve(native.config.rootDir, file)).replaceAll('\\', '/');
  const expectedCases = [], cases = [], failures = [], errors = [...native.errors];
  const files = new Map();
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        const item = { file: portable(spec.file), name: spec.title, nesting: 0, line: spec.line, column: spec.column, type: 'test' };
        expectedCases.push(item);
        for (const result of test.results) {
          const status = ({ passed: 'passed', failed: 'failed', timedOut: 'timed-out', skipped: 'skipped', interrupted: 'cancelled' })[result.status] ?? 'incomplete';
          const actual = { ...item, status, durationMs: result.duration, startedAt: result.startTime, completedAt: new Date(Date.parse(result.startTime) + result.duration).toISOString(), retry: result.retry, workerIndex: result.workerIndex };
          cases.push(actual);
          if (result.retry !== 0) errors.push({ message: `不允许重试掩盖首次失败：${item.name}` });
          if (test.expectedStatus !== 'passed') errors.push({ message: `UI 场景未要求实际通过：${item.name}` });
          for (const error of result.errors ?? []) failures.push({ ...item, ...(error.location ? { errorLocation: { ...error.location, file: portable(error.location.file) } } : {}), message: error.message ?? result.error?.message ?? status, status });
        }
        const results = cases.filter(actual => actual.file === item.file && actual.line === item.line && actual.column === item.column && actual.name === item.name);
        const passed = results.length === 1 && results[0].status === 'passed';
        files.set(item.file, { file: item.file, status: passed && (files.get(item.file)?.status ?? 'passed') === 'passed' ? 'passed' : 'failed' });
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of native.suites) visit(suite);
  const counts = { tests: cases.length, suites: 0, passed: 0, failed: 0, skipped: 0, todo: 0, cancelled: 0 };
  for (const item of cases) {
    if (['passed', 'failed', 'skipped', 'cancelled'].includes(item.status)) counts[item.status]++;
    else counts.failed++;
  }
  const complete = Number.isFinite(native.stats.duration) && native.stats.duration >= 0;
  return { executor: { name: 'playwright', version: native.config.version }, executionId: native.config.metadata?.executionId,
    startedAt: native.stats.startTime, completedAt: new Date(Date.parse(native.stats.startTime) + native.stats.duration).toISOString(), complete,
    expectedCases, cases, files: [...files.values()], failures, errors,
    summary: { success: complete && !errors.length && !failures.length && !native.stats.unexpected && !native.stats.flaky && !native.stats.skipped && cases.length > 0 && cases.every(item => item.status === 'passed'), counts } };
}
