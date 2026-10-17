import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { withCheckRun } from './check-lifecycle.mjs';
import { runLogged } from './check-runner.mjs';
import { registerPlaywrightResources } from './playwright-resources.mjs';
import { executionPlan, executionIdentity, executorEvidence } from './test-evidence.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  const { values } = parseArgs({ options: { files: { type: 'string' }, suite: { type: 'string', default: 'ui' }, concurrency: { type: 'string', default: process.env.CLAPGRID_TEST_CONCURRENCY ?? '1' } } });
  if (!['1', '2'].includes(values.concurrency)) throw Error('Playwright 并发仅允许 1 或 2');
  const plan = executionPlan(root, { suite: values.suite, files: JSON.parse(values.files ?? '[]'), executor: 'playwright' });
  const reportPath = resolve(process.env.CLAPGRID_TEST_REPORT ?? `logs/tests/${Date.now()}-playwright.json`);
  const nativePath = reportPath.replace(/\.json$/, '') + '-native.json';
  mkdirSync(dirname(reportPath), { recursive: true });
  const executionId = process.env.CLAPGRID_TEST_EXECUTION_ID ?? randomUUID();
  if (!process.env.CLAPGRID_CHECK_REGISTRY || resolve(process.env.CLAPGRID_CHECK_COMMAND_ROOT ?? '') !== resolve(root)) {
    const result = await withCheckRun(root, 'playwright', context => runLogged(process.execPath, process.argv.slice(1), root, `${reportPath}.log`, context, { CLAPGRID_TEST_REPORT: reportPath, CLAPGRID_TEST_EXECUTION_ID: executionId }));
    process.exitCode = result.status === 'passed' ? 0 : result.status === 'cancelled' ? 130 : 1;
    // 外层拥有者已确认组结束并回收登记资源。
  } else {
  const resource = registerPlaywrightResources(dirname(reportPath), executionId);
  const parentIdentity = process.env.CLAPGRID_TEST_IDENTITY ? JSON.parse(process.env.CLAPGRID_TEST_IDENTITY) : null;
  if (parentIdentity && parentIdentity.executionId !== executionId) throw Error('父执行身份与当前执行不符');
  const identity = parentIdentity ?? executionIdentity(root, executionId);
  const logPath = `${reportPath}.playwright.log`;
  const log = createWriteStream(logPath);
  const childEnv = { ...process.env, CLAPGRID_TEST_EXECUTION_ID: executionId, CLAPGRID_PLAYWRIGHT_RESOURCE_ROOT: resource.directory, CLAPGRID_PLAYWRIGHT_FILES: JSON.stringify(plan.files), CLAPGRID_PLAYWRIGHT_NATIVE: nativePath, CLAPGRID_TEST_CONCURRENCY: values.concurrency, CLAPGRID_PLAYWRIGHT_OUTPUT: `${reportPath}-results` };
  delete childEnv.NODE_TEST_CONTEXT;
  console.log(`预期执行 playwright（并发 ${values.concurrency}）：${plan.files.join(', ')}`);
  const child = spawn(process.execPath, [resolve(root, 'node_modules/@playwright/test/cli.js'), 'test', '--config', resolve(root, 'playwright.config.ts')], { cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  child.stdout.on('data', chunk => { log.write(chunk); process.stdout.write(chunk); });
  child.stderr.on('data', chunk => { log.write(chunk); process.stderr.write(chunk); });
  const ignore = () => {};
  process.on('SIGINT', ignore); process.on('SIGTERM', ignore);
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('close', async (code, signal) => {
    await new Promise(done => log.end(done));
    process.off('SIGINT', ignore); process.off('SIGTERM', ignore);
    try {
      const evidence = executorEvidence(root, plan, nativePath, identity, { strict: true, logPath });
      writeFileSync(reportPath, JSON.stringify(evidence, null, 2) + '\n');
      if (evidence.status !== 'passed') console.error(evidence.validationError);
      process.exitCode = code === 0 && evidence.status === 'passed' ? 0 : code || (signal ? 130 : 1);
    } catch (error) { console.error(`Playwright 报告缺失或无效：${error.message}`); process.exitCode = code || 1; }
  });
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
