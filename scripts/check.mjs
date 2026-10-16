import { fileURLToPath } from 'node:url';
import { runCheck } from './check-runner.mjs';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  const { values } = parseArgs({ options: { preflight: { type: 'boolean' }, failed: { type: 'boolean' } } });
  const summary = await runCheck(root, undefined, { mode: values.failed ? 'recheck' : values.preflight ? 'preflight' : 'development' });
  console.log(`检查结果：${summary.status}`);
  process.exitCode = summary.status === 'passed' ? 0 : summary.status === 'cancelled' ? 130 : 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
