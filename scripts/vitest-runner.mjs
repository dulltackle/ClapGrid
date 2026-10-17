import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executionPlan, executionIdentity, executorEvidence } from './test-evidence.mjs';
import { parseArgs } from 'node:util';

export async function runVitest(root, plan, report, identity) {
  const nativePath = report.replace(/\.json$/, '') + '-native.json';
  const logPath = report + '.log';
  const log = createWriteStream(logPath);
  const require = createRequire(resolve(root, 'package.json'));
  const bin = fileURLToPath(new URL('./vitest.mjs', new URL(require.resolve('vitest/package.json'), 'file:')));
  const env = { ...process.env, CLAPGRID_TEST_EXECUTION_ID: identity.executionId, CLAPGRID_VITEST_NATIVE_REPORT: nativePath }; delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [bin, 'run', '--includeTaskLocation', '--pool=threads', '--allowOnly=false', '--retry=0', '--maxWorkers=1', '--no-file-parallelism', '--config', 'vitest.config.ts', '--reporter=default', '--reporter=json', `--outputFile.json=${nativePath}.vitest.json`, `--reporter=${resolve(root, 'scripts/vitest-reporter.mjs')}`, ...plan.files], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  const ignore = () => {}; process.on('SIGINT', ignore); process.on('SIGTERM', ignore);
  const capture = (target, chunk) => { target.write(chunk); log.write(chunk); };
  child.stdout.on('data', chunk => capture(process.stdout, chunk)); child.stderr.on('data', chunk => capture(process.stderr, chunk));
  let failure;
  child.on('error', error => { failure = error; });
  const { code, signal } = await new Promise(resolveExit => child.on('close', (code, signal) => resolveExit({ code, signal })));
  await new Promise(resolveLog => log.end(resolveLog));
  process.off('SIGINT', ignore); process.off('SIGTERM', ignore);
  try {
    const evidence = executorEvidence(root, plan, nativePath, identity, { logPath, additionalSources: [`${nativePath}.vitest.json`] });
    writeFileSync(report, JSON.stringify(evidence, null, 2) + '\n');
    if (evidence.status !== 'passed') console.error(evidence.validationError);
    return code === 0 && !failure && evidence.status === 'passed' ? 0 : code || (signal ? 130 : 1);
  } catch (error) { console.error(`Vitest 报告缺失或无效：${error.message}`); return code || (signal ? 130 : 1); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { files: { type: 'string' }, suite: { type: 'string', default: 'all' } } });
    const root = resolve(import.meta.dirname, '..');
    const plan = executionPlan(root, { suite: values.suite, files: values.files ? JSON.parse(values.files) : undefined, executor: 'vitest' });
    const report = resolve(process.env.CLAPGRID_TEST_REPORT ?? `logs/tests/${Date.now()}-${process.pid}.json`); mkdirSync(dirname(report), { recursive: true });
    process.exitCode = await runVitest(root, plan, report, executionIdentity(root, process.env.CLAPGRID_TEST_EXECUTION_ID ?? randomUUID()));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
