// Linux 验收：追踪测试及媒体守护进程的 exec 系统调用，检查导出拒绝窗口。
import assert from 'node:assert/strict';
import { command } from '../tests/helpers/command-runtime.mjs';
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
for (const file of ['exec.trace', 'tests.log', 'vitest.json', 'preflight.log']) writeFileSync(join(directory, file), '');
writeFileSync(join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n');
writeFileSync(join(directory, 'summary.md'), '# Linux 导出拒绝进程追踪\n\n未完成：请检查工作流和追踪日志，不可视为通过。\n');
const cancellation = new AbortController();
const interrupt = () => cancellation.abort(Error('用户取消进程追踪'));
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
async function run(file, args, options) {
  const child = command(file, args, { ...options, signal: cancellation.signal });
  let primary;
  try { return await child; }
  catch (error) { primary = error; throw error; }
  finally {
    try { await child.stop(); }
    catch (error) { if (primary && primary !== error) throw new AggregateError([primary, error], '追踪命令失败且退出未确认'); throw error; }
  }
}
try {
  assert.equal(process.platform, 'linux', '该进程追踪只适用于 Linux，需要安装 strace');
  for (const [command, args] of [['strace', ['-V']], ['ffmpeg', ['-version']], ['ffprobe', ['-version']],
    ['fc-match', ['-f', '%{family}', 'Noto Sans CJK SC']]]) {
    const check = await run(command, args, { cwd, encoding: 'utf8', timeout: 10000 });
    appendFileSync(join(directory, 'preflight.log'), `$ ${command} ${args.join(' ')}\n${check.stdout ?? ''}${check.stderr ?? ''}\n`);
    assert.ok(!check.error && check.status === 0, `必需依赖 ${command} 不可用：${check.error?.message ?? check.stderr ?? check.status}`);
    if (command === 'fc-match') assert.match(check.stdout, /Noto Sans CJK SC/, '缺少 Noto Sans CJK SC 字体');
  }
  const permission = await run('strace', ['-f', '-o', trace, process.execPath, '-e', ''], { encoding: 'utf8', timeout: 10000 });
  appendFileSync(join(directory, 'preflight.log'), permission.stderr ?? '');
  assert.ok(!permission.error && permission.status === 0, `strace 追踪权限或能力不可用：${permission.error?.message ?? permission.stderr}`);
  // 直接运行原生 Vitest；业务窗口由测试写入原生 metadata。
  const reportPath = join(directory, 'vitest.json');
  const checked = await run('strace', ['-f', '-ttt', '-s', '4096', '-e', 'trace=execve,execveat', '-o', trace,
    process.execPath, 'node_modules/vitest/vitest.mjs', 'run', 'tests/speech-export-lock.test.ts', '--reporter=json', '--outputFile', reportPath],
  { cwd, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(join(directory, 'tests.log'), (checked.stdout ?? '') + (checked.stderr ?? ''));
  if (checked.error) throw checked.error;
  assert.equal(checked.status, 0, `回归或 strace 失败，查看 ${directory}/tests.log`);
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(report.success, true, '本次完整回归必须通过');
  assert.equal(report.numTotalTests, 4, '必须实际收集全部四项配音导出锁回归');
  assert.equal(report.numPassedTests, 4, '四项回归必须全部通过，不得跳过');
  assert.equal(report.testResults.length, 1, '专项只运行指定业务测试文件');
  const cases = report.testResults[0].assertionResults;
  assert.equal(cases.length, 4, '必须实际报告四项回归');
  assert.ok(cases.every(item => item.status === 'passed'), '每项回归都必须实际通过');
  result.nativeTestReport = reportPath;
  const windows = cases.flatMap(item => item.meta.exportRejectionWindows ?? []);
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
  appendFileSync(join(directory, 'tests.log'), `\n追踪验收失败：${result.reason}\n`);
  process.exitCode = 1;
}
process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
writeFileSync(join(directory, 'summary.md'), `# Linux 导出拒绝进程追踪\n\n结果：${result.status === 'passed' ? '通过' : '失败'}\n\n${result.reason}\n\n${result.provider}\n\nFFmpeg 正向对照：${result.baselineFfmpegExecs}；完整拒绝窗口：${result.windows.length}\n\n证据：exec.trace、tests.log、vitest.json、preflight.log、result.json。\n`);
writeFileSync(join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
