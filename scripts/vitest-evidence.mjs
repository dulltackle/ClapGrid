import { resolve, relative } from 'node:path';

/** 将 Vitest 原生事件解释为公共证据模型；保留原始 reason 和错误语义。 */
export function normalizeNative(root, native) {
  if (native.kind !== 'vitest-native' || native.schemaVersion !== 1 || !Array.isArray(native.expectedFiles)) throw Error('Vitest 原生事件格式无效');
  const portable = item => ({ ...item, ...(item.file ? { file: relative(root, resolve(root, item.file)).replaceAll('\\', '/') } : {}) });
  const cases = (native.cases ?? []).map(portable);
  const counts = { tests: cases.length, suites: 0, passed: 0, failed: 0, skipped: 0, todo: 0, cancelled: 0 };
  for (const item of cases) if (item.status in counts) counts[item.status]++;
  const failures = (native.failures ?? []).map(portable), errors = [...(native.errors ?? [])];
  const files = (native.files ?? []).map(item => ({ ...portable(item), nativeStatus: item.status, status: item.status === 'skipped' ? 'passed' : item.status }));
  const expectedFiles = native.expectedFiles.map(file => portable({ file }).file).sort();
  if (JSON.stringify(expectedFiles) !== JSON.stringify(files.map(item => item.file).sort())) errors.push({ message: 'Vitest 收集文件与完成文件不符' });
  const complete = ['passed', 'failed'].includes(native.reason) && !!native.completedAt;
  return { ...native, complete, expectedCases: (native.expectedCases ?? []).map(portable), cases, files, failures, errors,
    summary: { success: native.reason === 'passed' && !failures.length && !errors.length, counts } };
}
