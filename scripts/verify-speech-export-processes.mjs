// Linux 验收：追踪测试及媒体守护进程的 exec 系统调用，检查导出拒绝窗口。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(cwd, process.argv[2] ?? '.cache/issue-33-processes');
mkdirSync(directory, { recursive: true });
const trace = join(directory, 'exec.trace');
const result = { at: new Date().toISOString(), platform: process.platform, node: process.version,
  provider: '受控供应商响应；不是本轮真实供应商或宿主验收', status: 'failed', reason: '运行未完成，尚无可接受的追踪结果',
  baselineFfmpegExecs: 0, windows: [] };
for (const file of ['exec.trace', 'tests.tap', 'preflight.log']) writeFileSync(join(directory, file), '');
writeFileSync(join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n');
writeFileSync(join(directory, 'summary.md'), '# Linux 导出拒绝进程追踪\n\n未完成：请检查工作流和追踪日志，不可视为通过。\n');
try {
  assert.equal(process.platform, 'linux', '该进程追踪只适用于 Linux，需要安装 strace');
  for (const [command, args] of [['strace', ['-V']], ['ffmpeg', ['-version']], ['ffprobe', ['-version']],
    ['fc-match', ['-f', '%{family}', 'Noto Sans CJK SC']]]) {
    const check = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 10000 });
    appendFileSync(join(directory, 'preflight.log'), `$ ${command} ${args.join(' ')}\n${check.stdout ?? ''}${check.stderr ?? ''}\n`);
    assert.ok(!check.error && check.status === 0, `必需依赖 ${command} 不可用：${check.error?.message ?? check.stderr ?? check.status}`);
    if (command === 'fc-match') assert.match(check.stdout, /Noto Sans CJK SC/, '缺少 Noto Sans CJK SC 字体');
  }
  const permission = spawnSync('strace', ['-f', '-o', trace, process.execPath, '-e', ''], { encoding: 'utf8', timeout: 10000 });
  appendFileSync(join(directory, 'preflight.log'), permission.stderr ?? '');
  assert.ok(!permission.error && permission.status === 0, `strace 追踪权限或能力不可用：${permission.error?.message ?? permission.stderr}`);
  // 沿唯一归属分派真实测试；本次报告与窗口不依赖执行者的控制台格式。
  const { randomUUID, createHash } = await import('node:crypto');
  const { executionPlan, executionIdentityAsync, validateExecutionSourceAsync } = await import('./test-evidence.mjs');
  const files = ['tests/speech-export-lock.test.ts'];
  const plan = executionPlan(cwd, { suite: 'all', files });
  const executionId = randomUUID();
  const identity = await executionIdentityAsync(cwd, executionId);
  const reportPath = join(directory, 'test-execution.json');
  const run = spawnSync('strace', ['-f', '-ttt', '-s', '4096', '-e', 'trace=execve,execveat', '-o', trace,
    process.execPath, 'scripts/test-runner.mjs', '--files', JSON.stringify(files)],
  { cwd, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, CLAPGRID_TEST_EXECUTION_ID: executionId, CLAPGRID_TEST_REPORT: reportPath } });
  // 保留原 artifact 文件名；内容是实际执行者日志，不伪装成 TAP 诊断。
  writeFileSync(join(directory, 'tests.tap'), (run.stdout ?? '') + (run.stderr ?? ''));
  if (run.error) throw run.error;
  assert.equal(run.status, 0, `回归或 strace 失败，查看 ${directory}/tests.tap`);
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  await validateExecutionSourceAsync(cwd, report, plan, identity, { strict: true });
  assert.equal(report.status, 'passed', '本次完整回归必须通过');
  assert.equal(report.actual.cases.length, 4, '必须实际完成全部四项配音导出锁回归');
  result.testExecution = { report: reportPath, sha256: createHash('sha256').update(readFileSync(reportPath)).digest('hex'),
    executionId, sources: report.sources };
  const windows = report.actual.cases.flatMap(item => item.annotations ?? [])
    .filter(item => item.message.startsWith('LOCK_WINDOW ')).map(item => JSON.parse(item.message.slice('LOCK_WINDOW '.length)));
  result.windows = windows;
  assert.deepEqual(windows.map(item => `${item.outcome}:${item.phase ?? 'queued'}`).sort(),
    ['成功:accepted', '成功:running', '明确失败:accepted', '明确失败:running', '中断:accepted', '中断:running', '批量等待:queued'].sort(), '每个场景都必须提供拒绝窗口');
  const calls = readFileSync(trace, 'utf8').split('\n').filter(line => /\bexecve(?:at)?\(/.test(line)).map(line => {
    const timestamp = line.match(/^\d+\s+(\d+\.\d+)\s/);
    assert.ok(timestamp, `无法解析追踪时间：${line}`);
    return { at: Number(timestamp[1]) * 1000, line };
  });
  // 正向对照：必须确实跟踪到成功启动的 FFmpeg，而不是空追踪误报通过。
  const ffmpeg = calls.filter(call => /execve\("[^"\n]*\/ffmpeg"/.test(call.line)
    && call.line.includes('/exports/.work-') && /= 0$/.test(call.line));
  result.baselineFfmpegExecs = ffmpeg.length;
  assert.ok(ffmpeg.length > 0, '未跟踪到媒体守护进程中基线导出的 FFmpeg 启动');
  for (const window of windows) {
    assert.ok(window.end > window.start, '拒绝窗口必须有有效时长');
    assert.ok(ffmpeg.some(call => call.at < window.start), '窗口前必须已有 FFmpeg 正向对照');
    // Date.now 只有毫秒精度，结束边界扩展 1 ms，避免漏掉最后一毫秒的启动。
    window.execCalls = calls.filter(call => call.at >= window.start && call.at < window.end + 1).map(call => call.line);
    assert.deepEqual(window.execCalls, [], '拒绝期间不应启动任何可执行文件');
  }
  Object.assign(result, { status: 'passed', reason: '', baselineFfmpegExecs: ffmpeg.length, windows });
} catch (error) {
  result.reason = error instanceof Error ? error.message : String(error);
  appendFileSync(join(directory, 'tests.tap'), `\n追踪验收失败：${result.reason}\n`);
  process.exitCode = 1;
}
writeFileSync(join(directory, 'summary.md'), `# Linux 导出拒绝进程追踪\n\n结果：${result.status === 'passed' ? '通过' : '失败'}\n\n${result.reason}\n\n${result.provider}\n\nFFmpeg 正向对照：${result.baselineFfmpegExecs}；完整拒绝窗口：${result.windows.length}\n\n证据：exec.trace、tests.tap、preflight.log、result.json。\n`);
writeFileSync(join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
