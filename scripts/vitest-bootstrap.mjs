import { Socket } from 'node:net';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// 只加载第三方框架；普通管道不引入 process.send 等 IPC 可见状态。
const pipe = new Socket({ fd: 3, readable: true, writable: true });
let released = false;
let ready = false;
let buffer = '';
let finish, fail;
const barrier = new Promise((yes, no) => { finish = yes; fail = no; });
barrier.catch(() => {});
pipe.on('error', fail);
pipe.on('end', () => { if (!released) fail(Error('源码校验前父管道已关闭')); pipe.destroy(); });
pipe.on('close', () => { if (released) finish(); else fail(Error('源码校验许可缺失')); });
pipe.on('data', chunk => {
  buffer += chunk;
  if (buffer.length > 4096) { fail(Error('源码校验许可超长')); pipe.destroy(); return; }
  const newline = buffer.indexOf('\n');
  if (newline < 0) return;
  try {
    const message = JSON.parse(buffer.slice(0, newline));
    if (!ready || message.kind !== 'release' || message.nonce !== process.env.CLAPGRID_TEST_EXECUTION_ID || buffer.slice(newline + 1)) throw Error('源码校验许可身份不符');
    released = true;
  } catch (error) { fail(error); }
  pipe.destroy();
});
const root = resolve(process.cwd());
const require = createRequire(resolve(root, 'package.json'));
const { startVitest } = await import(pathToFileURL(require.resolve('vitest/node')).href);
ready = true;
pipe.write(JSON.stringify({ kind: 'ready', nonce: process.env.CLAPGRID_TEST_EXECUTION_ID }) + '\n');
await barrier;

// 公共 API 仍只在受控 child 中运行；项目配置和报告器必须等完整 before 放行。
let context;
try {
  context = await startVitest(process.argv.slice(2), {
    root, config: 'vitest.config.ts', run: true, watch: false,
    environment: 'node', pool: 'forks', maxWorkers: 1, fileParallelism: false, isolate: true,
    retry: 0, allowOnly: false, passWithNoTests: false, includeTaskLocation: true,
    reporters: ['default', resolve(root, 'scripts/vitest-reporter.mjs')],
  });
  // 与原 CLI 相同，保留退出超时诊断；close 自身等待 worker 池及原始报告完成。
  if (!context.shouldKeepServer()) await context.exit();
} catch (error) { console.error(error); process.exitCode = 1; }
finally { await context?.close(); }
