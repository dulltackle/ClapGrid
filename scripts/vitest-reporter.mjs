import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/** 直接保存 Vitest 生命周期事件；收集与完成分别记录，不能由结果反推预期。 */
export default class VitestReporter {
  onInit() {
    this.version = createRequire(import.meta.url)('vitest/package.json').version;
    this.expectedCases = []; this.cases = []; this.files = []; this.failures = []; this.errors = [];
  }
  onTestRunStart(specifications) {
    this.startedAt = new Date().toISOString();
    this.expectedFiles = specifications.map(specification => specification.moduleId);
  }
  item(test) {
    let nesting = 0; for (let parent = test.parent; parent?.type === 'suite'; parent = parent.parent) nesting++;
    return { file: test.module.moduleId, name: test.fullName, nesting, line: test.location?.line, column: test.location?.column, type: 'test' };
  }
  onTestModuleCollected(module) {
    for (const test of module.children.allTests()) this.expectedCases.push(this.item(test));
  }
  onTestCaseResult(test) {
    const result = test.result();
    const status = test.options.mode === 'todo' ? 'todo' : result.state;
    const item = { ...this.item(test), status, durationMs: test.diagnostic()?.duration, completedAt: new Date().toISOString() };
    this.cases.push(item);
    for (const error of result.errors ?? []) this.failures.push({ ...this.item(test), message: error.message ?? String(error), stack: error.stack });
  }
  onTestModuleEnd(module) {
    this.files.push({ file: module.moduleId, status: module.state() });
    for (const error of module.errors()) this.failures.push({ file: module.moduleId, name: '测试文件收集或执行失败', message: error.message ?? String(error), stack: error.stack });
  }
  onTestRunEnd(_modules, errors, reason) {
    this.errors.push(...errors.map(error => ({ message: error.message ?? String(error), stack: error.stack })));
    const native = { schemaVersion: 1, kind: 'vitest-native', executor: { name: 'vitest', version: this.version }, executionId: process.env.CLAPGRID_TEST_EXECUTION_ID,
      startedAt: this.startedAt, completedAt: new Date().toISOString(), reason,
      expectedFiles: this.expectedFiles, expectedCases: this.expectedCases, cases: this.cases, files: this.files, failures: this.failures, errors: this.errors };
    writeFileSync(process.env.CLAPGRID_VITEST_NATIVE_REPORT, JSON.stringify(native, null, 2) + '\n');
  }
}
