import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { executionPlan, failureFiles, executionIdentity, nodeEvidence, aggregateEvidence, testInventory, ownedTests, validateExecution } from './test-evidence.mjs';

export const rowTests = ['panel-targets', 'segment-note-layout-panel', 'speech-cell-layout-panel', 'drag-scroll-panel', 'editing-panel', 'wide-panel', 'row-menu-panel', 'long-text-panel'];
export { failureFiles } from './test-evidence.mjs';

async function runNode(root, plan, report, identity) {
  const nativePath = report.replace(/\.json$/, '') + '-native.json';
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const loader = pkg.devDependencies?.tsx ? ['--import', 'tsx'] : [];
  const child = spawn(process.execPath, [...loader, '--test', '--test-concurrency=1',
    '--test-reporter=tap', '--test-reporter-destination=stdout', '--test-reporter=./scripts/test-reporter.mjs', `--test-reporter-destination=${nativePath}`, '--test-reporter=tap', `--test-reporter-destination=${report}.tap.log`, ...plan.files],
  { cwd: root, stdio: 'inherit', env: { ...process.env, CLAPGRID_TEST_EXECUTION_ID: identity.executionId }, detached: false });
  let failure; child.on('error', error => { failure = error; });
  const { code, signal } = await new Promise(done => child.on('close', (code, signal) => done({ code, signal })));
  try {
    const evidence = nodeEvidence(root, plan, nativePath, identity, { logPath: `${report}.tap.log` });
    writeFileSync(report, JSON.stringify(evidence, null, 2) + '\n');
    if (evidence.status !== 'passed') console.error(evidence.validationError);
    return code === 0 && !failure && evidence.status === 'passed' ? 0 : code || (signal ? 130 : 1);
  } catch (error) { console.error(`测试报告缺失或无效：${error.message}`); return code || (signal ? 130 : 1); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let cancelled = false;
  const cancel = () => { cancelled = true; };
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  try {
    const { values } = parseArgs({ options: { suite: { type: 'string', default: 'all' }, files: { type: 'string' }, concurrency: { type: 'string', default: '1' } } });
    if (!['all', 'rows', 'tooling', 'failed', 'logic', 'service', 'native-logic', 'native-service', 'native-ui', 'ui', 'ui-core', 'ui-extended', 'styles'].includes(values.suite)) throw Error('未知测试范围');
    if (!['1', '2'].includes(values.concurrency)) throw Error('--concurrency 仅支持 1 或 2');
    const root = resolve(import.meta.dirname, '..');
    let files = values.files ? JSON.parse(values.files) : undefined;
    if (values.suite === 'failed') {
      const manifest = JSON.parse(readFileSync(process.env.CLAPGRID_FAILURE_MANIFEST ?? resolve(root, 'logs/check-state/failures.json'), 'utf8'));
      const failed = failureFiles(root, manifest.failures ?? [], { referenceFiles: manifest.referenceFiles ?? [] });
      files = failed.length ? failed : testInventory(root).map(entry => entry.file);
    }
    const plan = executionPlan(root, { suite: values.suite, ...(files ? { files } : {}) });
    const executionId = process.env.CLAPGRID_TEST_EXECUTION_ID ?? randomUUID();
    const identity = executionIdentity(root, executionId);
    const report = resolve(process.env.CLAPGRID_TEST_REPORT ?? `logs/tests/${Date.now()}-${process.pid}.json`); mkdirSync(dirname(report), { recursive: true });
    console.log(`预期执行 ${plan.executor}（${plan.suite}）：${plan.files.join(', ')}`);
    const inventory = ownedTests(root);
    const owner = file => inventory.find(entry => entry.file === file)?.executor;
    const owners = [...new Set(plan.files.map(owner))];
    const paths = []; let status = 0;
    for (const executor of owners) {
      if (cancelled) break;
      const selected = plan.files.filter(file => owner(file) === executor);
      const childPlan = executionPlan(root, { suite: plan.suite, files: selected, executor });
      const target = owners.length === 1 ? report : report.replace(/\.json$/, '') + `-${executor}.json`;
      let code;
      if (executor === 'node') code = await runNode(root, childPlan, target, identity);
      else if (executor === 'vitest') {
        const { runVitest } = await import('./vitest-runner.mjs');
        code = await runVitest(root, childPlan, target, identity);
      } else {
        const child = spawn(process.execPath, [`scripts/${executor}-runner.mjs`, '--files', JSON.stringify(selected), '--suite', plan.suite], { cwd: root, stdio: 'inherit', env: { ...process.env, CLAPGRID_TEST_REPORT: target, CLAPGRID_TEST_EXECUTION_ID: executionId, CLAPGRID_TEST_CONCURRENCY: values.concurrency, CLAPGRID_TEST_IDENTITY: JSON.stringify(identity) }, detached: false });
        child.on('error', error => console.error(error.message));
        code = await new Promise(done => child.on('close', (code, signal) => done(code ?? (signal ? 130 : 1))));
      }
      try { validateExecution(root, JSON.parse(readFileSync(target, 'utf8')), childPlan, identity); }
      catch (error) { console.error(`执行者报告无效：${error.message}`); code ||= 1; }
      paths.push(target); if (code) status = code;
    }
    if (owners.length > 1 && paths.every(existsSync) && paths.length === owners.length) {
      const evidence = aggregateEvidence(root, plan, paths, identity); writeFileSync(report, JSON.stringify(evidence, null, 2) + '\n');
      if (evidence.status !== 'passed') { console.error(evidence.validationError); status ||= 1; }
    }
    process.exitCode = cancelled ? 130 : status;
  } catch (error) { console.error(error.message); process.exitCode = cancelled ? 130 : 1; }
  finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
}
