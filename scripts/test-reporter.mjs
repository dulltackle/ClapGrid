import { resolve } from 'node:path';

/** 与 TAP 同时消费原生事件；文件摘要及全局摘要必须分别完成。 */
export default async function* report(source) {
  const startedAt = new Date().toISOString();
  const failures = [], cases = [], expectedCases = [], files = [], errors = [];
  let summary;
  const fileEnvelope = data => data.file && resolve(data.name) === resolve(data.file);
  const item = data => ({ file: data.file, name: data.name, nesting: data.nesting, line: data.line, column: data.column, type: data.details?.type ?? data.type ?? 'test' });
  for await (const { type, data } of source) {
    if (type === 'test:enqueue' && !fileEnvelope(data)) expectedCases.push(item(data));
    if (['test:pass', 'test:fail'].includes(type) && !fileEnvelope(data)) {
      const status = data.skip ? 'skipped' : data.todo ? 'todo' : type === 'test:pass' ? 'passed' : data.details?.error?.failureType === 'cancelledByParent' ? 'cancelled' : 'failed';
      cases.push({ ...item(data), status, durationMs: data.details?.duration_ms, completedAt: new Date().toISOString() });
    }
    if (type === 'test:fail' && data.details?.error?.failureType !== 'subtestsFailed') {
      failures.push({ ...item(data), message: String(data.details?.error?.cause?.message ?? data.details?.error?.message ?? '测试失败') });
    }
    if (type === 'test:diagnostic' && /uncaughtException|unhandledRejection/.test(data.message)) errors.push(data.message);
    if (type === 'test:summary') {
      if (data.file) files.push({ file: data.file, status: data.success ? 'passed' : 'failed', counts: data.counts });
      else summary = data;
    }
  }
  yield JSON.stringify({ schemaVersion: 2, kind: 'node-native', executionId: process.env.CLAPGRID_TEST_EXECUTION_ID, executor: { name: 'node', version: process.version }, startedAt, completedAt: new Date().toISOString(), complete: !!summary, expectedCases, cases, files, failures, errors, summary }, null, 2) + '\n';
}
