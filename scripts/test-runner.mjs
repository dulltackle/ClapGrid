import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { executionPlan, failureFiles, executionIdentity, nodeEvidence } from './test-evidence.mjs';

export const rowTests = ['panel-targets', 'segment-note-layout-panel', 'speech-cell-layout-panel', 'drag-scroll-panel', 'editing-panel', 'wide-panel', 'row-menu-panel', 'long-text-panel'];

export { failureFiles } from './test-evidence.mjs';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { suite: { type: 'string', default: 'all' } } });
    if (!['all', 'rows', 'tooling', 'failed', 'native-logic', 'native-service', 'native-ui'].includes(values.suite)) throw Error('未知测试范围');
    const root = resolve(import.meta.dirname, '..');
    let files = executionPlan(root).files;
    if (values.suite === 'failed') {
      const manifest = JSON.parse(readFileSync(process.env.CLAPGRID_FAILURE_MANIFEST ?? resolve(root, 'logs/check-state/failures.json'), 'utf8'));
      const failed = failureFiles(root, manifest.failures ?? [], { referenceFiles: manifest.referenceFiles ?? [] });
      if (failed.length) files = failed;
    }
    const plan = executionPlan(root, { suite: values.suite, ...(values.suite === 'failed' ? { files } : {}) });
    files = plan.files;
    const executionId = process.env.CLAPGRID_TEST_EXECUTION_ID ?? randomUUID();
    const identity = executionIdentity(root, executionId);
    console.log(`预期执行 ${plan.executor} ${process.version}（${plan.suite}）：${files.join(', ')}`);
    const report = resolve(process.env.CLAPGRID_TEST_REPORT ?? `logs/tests/${Date.now()}-${process.pid}.json`);
    mkdirSync(dirname(report), { recursive: true });
    const nativePath = report.replace(/\.json$/, '') + '-native.json';
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    const loader = pkg.devDependencies?.tsx ? ['--import', 'tsx'] : [];
    const child = spawn(process.execPath, [...loader, '--test', '--test-concurrency=1',
      '--test-reporter=tap', '--test-reporter-destination=stdout', '--test-reporter=./scripts/test-reporter.mjs', `--test-reporter-destination=${nativePath}`, '--test-reporter=tap', `--test-reporter-destination=${report}.tap.log`, ...files], { cwd: root, stdio: 'inherit', env: { ...process.env, CLAPGRID_TEST_EXECUTION_ID: executionId } });
    // 此进程与原生测试运行器保持同一受控进程组，由检查生命周期统一停止。
    const ignore = () => {};
    process.on('SIGINT', ignore); process.on('SIGTERM', ignore);
    child.on('error', error => { console.error(error); process.exitCode = 1; });
    child.on('close', (code, signal) => {
      process.off('SIGINT', ignore); process.off('SIGTERM', ignore);
      try {
        const evidence = nodeEvidence(root, plan, nativePath, identity, { logPath: `${report}.tap.log` });
        writeFileSync(report, JSON.stringify(evidence, null, 2) + '\n');
        if (evidence.status !== 'passed') console.error(evidence.validationError);
        process.exitCode = code === 0 && evidence.status === 'passed' ? 0 : code || (signal ? 130 : 1);
      } catch (error) { console.error(`测试报告缺失或无效：${error.message}`); process.exitCode = code || 1; }
    });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
