import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

// 只选非敏感 CI 身份；测量首步骤至汇总步骤，runner 准备及后续 artifact 上传不在此窗口。
const { values } = parseArgs({ options: { output: { type: 'string' }, 'timeout-minutes': { type: 'string' }, status: { type: 'string' } } });
const started = Date.parse(process.env.CLAPGRID_CI_STARTED_AT ?? '');
const timeoutSeconds = Number(values['timeout-minutes']) * 60;
if (!Number.isFinite(started) || started > Date.now() || !(timeoutSeconds > 0) || !['success', 'failure', 'cancelled', 'skipped'].includes(values.status) || !values.output) throw Error('CI 观察缺少有效起点、作业时限、状态或输出位置');
const durationSeconds = (Date.now() - started) / 1000;
const result = {
  schemaVersion: 1, startedAt: new Date(started).toISOString(), observedAt: new Date().toISOString(), durationSeconds,
  timeoutSeconds, timeoutMarginSeconds: timeoutSeconds - durationSeconds, status: values.status, passed: values.status === 'success',
  event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, target: process.env.GITHUB_SHA,
  runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
  note: '首步骤至本观察的实际时长；不含 runner 准备及之后的日志上传。最终结论以 GitHub job 为准；取消不算通过。',
};
const output = resolve(values.output); mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\nCI 状态：${result.status}；目标：${result.target}；耗时 ${durationSeconds.toFixed(1)} 秒；作业时限余量 ${result.timeoutMarginSeconds.toFixed(1)} 秒。\n${result.note}\n`);
console.log(JSON.stringify({ status: result.status, passed: result.passed, output }));
