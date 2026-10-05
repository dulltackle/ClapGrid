// Linux 验收：追踪测试及媒体守护进程的 exec 系统调用，检查导出拒绝窗口。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.platform, 'linux', '该进程追踪只适用于 Linux，需要安装 strace');
const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(cwd, process.argv[2] ?? '.cache/issue-33-processes');
mkdirSync(directory, { recursive: true });
rmSync(join(directory, 'result.json'), { force: true });
const trace = join(directory, 'exec.trace');
const run = spawnSync('strace', ['-f', '-ttt', '-s', '4096', '-e', 'trace=execve,execveat', '-o', trace,
  process.execPath, '--import', 'tsx', '--test', 'tests/speech-export-lock.test.ts'],
{ cwd, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
writeFileSync(join(directory, 'tests.tap'), (run.stdout ?? '') + (run.stderr ?? ''));
if (run.error) throw run.error;
assert.equal(run.status, 0, `回归或 strace 失败，查看 ${directory}/tests.tap`);
const windows = [...run.stdout.matchAll(/^# LOCK_WINDOW (.+)$/gm)].map(match => JSON.parse(match[1]));
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
assert.ok(ffmpeg.length > 0, '未跟踪到媒体守护进程中基线导出的 FFmpeg 启动');
for (const window of windows) {
  assert.ok(window.end > window.start, '拒绝窗口必须有有效时长');
  assert.ok(ffmpeg.some(call => call.at < window.start), '窗口前必须已有 FFmpeg 正向对照');
  // Date.now 只有毫秒精度，结束边界扩展 1 ms，避免漏掉最后一毫秒的启动。
  window.execCalls = calls.filter(call => call.at >= window.start && call.at < window.end + 1).map(call => call.line);
  assert.deepEqual(window.execCalls, [], '拒绝期间不应启动任何可执行文件');
}
const result = { at: new Date().toISOString(), platform: process.platform, node: process.version,
  provider: '受控供应商响应；不是本轮真实供应商或浏览器验收',
  baselineFfmpegExecs: ffmpeg.length, windows };
writeFileSync(join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
