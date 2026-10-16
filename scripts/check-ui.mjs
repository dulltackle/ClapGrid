import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runLogged } from './check-runner.mjs';
import { sameSource, sourceIdentity } from './check-source.mjs';
import { createUiPlan } from './ui-check-plan.mjs';

export function requireChrome(env = process.env) {
  const candidates = env.CHROME_BIN ? [env.CHROME_BIN] : ['google-chrome', 'chromium', 'chromium-browser'];
  for (const command of candidates) {
    try { return { command, version: execFileSync(command, ['--version'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }; } catch { /* 尝试已知浏览器入口。 */ }
  }
  throw Error('UI 快检需要真实 Chrome/Chromium；缺失浏览器不能跳过或记为通过。');
}

export async function checkUi(root, { base = 'HEAD', scope = 'extended', concurrency = 2, directory = join(root, 'logs/check-ui', `${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`) } = {}) {
  mkdirSync(directory, { recursive: true });
  const summary = { mode: 'ui-development', directory, startedAt: new Date().toISOString(), source: sourceIdentity(root), status: 'running', completeForLocalUi: false, results: [], note: 'UI 快检不是正式验收；保留完整 check、固定提交 verify 和实际宿主验收。' };
  const save = () => writeFileSync(join(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`UI 快检日志：${directory}`); save();
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
    const stages = [
      { name: 'typecheck', args: ['run', 'typecheck'] },
      { name: 'ui-tests', args: ['exec', '--', 'tsx', '--test', `--test-concurrency=${summary.effectiveConcurrency}`, ...summary.plan.tests] },
      { name: 'build', args: ['run', 'build'] },
    ];
    for (const stage of stages) {
      const result = await runLogged(npm, stage.args, root, join(directory, `${stage.name}.log`));
      if (stage.name === 'ui-tests' && result.status === 'passed') {
        const log = readFileSync(join(directory, 'ui-tests.log'), 'utf8');
        const total = name => Number(log.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1] ?? NaN);
        summary.testTotals = { tests: total('tests'), passed: total('pass'), failed: total('fail'), skipped: total('skipped'), cancelled: total('cancelled'), todo: total('todo') };
        if (!(summary.testTotals.tests >= summary.plan.tests.length) || summary.testTotals.passed !== summary.testTotals.tests || summary.testTotals.failed !== 0 || summary.testTotals.skipped !== 0 || summary.testTotals.cancelled !== 0 || summary.testTotals.todo !== 0) {
          result.status = 'failed'; result.error = 'UI 测试统计缺失、未执行或含跳过/取消/待办，不能视为快检通过。';
        }
      }
      summary.results.push({ name: stage.name, ...result });
      summary.sourceAfter = sourceIdentity(root);
      if (!sameSource(summary.source, summary.sourceAfter)) { summary.status = 'invalidated'; break; }
      save();
      if (result.status !== 'passed') { summary.status = 'failed'; break; }
    }
    if (summary.status === 'running') {
      summary.completeForLocalUi = summary.plan.requiredFollowup === null;
      summary.status = summary.completeForLocalUi ? 'passed' : 'requires-full-check';
    }
  } catch (error) { summary.status = 'failed'; summary.error = String(error); }
  finally {
    for (const [name, value] of [['CHROME_BIN', previous.chrome], ['CLAPGRID_BROWSER_TIMINGS', previous.timings], ['NODE_TEST_CONTEXT', previous.context]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
  summary.completedAt = new Date().toISOString(); save(); return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { base: { type: 'string', default: 'HEAD' }, scope: { type: 'string', default: 'extended' }, concurrency: { type: 'string', default: '2' }, plan: { type: 'boolean', default: false } } });
  const root = fileURLToPath(new URL('../', import.meta.url));
  if (values.plan) console.log(JSON.stringify(createUiPlan(root, values), null, 2));
  else {
    const result = await checkUi(root, values); console.log(`UI 快检结果：${result.status}`);
    process.exitCode = result.status === 'passed' ? 0 : result.status === 'requires-full-check' ? 2 : 1;
  }
}
