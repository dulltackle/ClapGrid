import { fileURLToPath } from 'node:url';
import { runCheck } from './check-runner.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const summary = await runCheck(root);
console.log(`检查结果：${summary.status}`);
process.exitCode = summary.status === 'passed' ? 0 : 1;
