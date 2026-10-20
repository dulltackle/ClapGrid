import { test, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { projectCleanup } from '../../helpers/project-cleanup.js';
import { command } from '../../helpers/vitest-command.js';
import { openBusiness } from '../../../src/business/index.js';

const root = process.env.CLAPGRID_FAULT_ROOT!;
const mode = process.env.CLAPGRID_TEST_FAULT!;
const directory = join(root, 'project');
const record = (name: string, value: unknown) => writeFileSync(join(root, name), JSON.stringify(value));
const known = JSON.parse(process.env.CLAPGRID_FOREIGN_OWNER ?? 'null');

test(`独立异常：${mode}`, { timeout: mode.startsWith('startup-') || mode === 'cancel' || mode === 'command-cleanup-failure' ? 2500 : 500 }, async t => {
  t.onTestFinished(() => record('observed.json', { directoryExists: existsSync(directory), cancelled: t.signal.aborted, reason: String(t.signal.reason) }));
  mkdirSync(directory);
  const kill = process.kill.bind(process);
  let unconfirmed: ReturnType<typeof command> | undefined;
  // 专项自己的最后收尾；被测清理仍必须报告失败、保留项目和原始原因。
  if (mode === 'command-cleanup-failure') t.onTestFinished(async () => {
    vi.restoreAllMocks();
    if (unconfirmed?.child.exitCode === null) {
      const ended = once(unconfirmed.child, 'exit');
      kill(unconfirmed.child.pid!, 'SIGKILL'); await ended;
    }
  }, 2000);
  const cleanup = projectCleanup(t); cleanup.directory(directory);
  if (mode === 'startup-timeout' || mode === 'cancel') {
    const preload = join(root, 'hold-ready.mjs');
    writeFileSync(preload, `import {writeFileSync} from 'node:fs';\nconsole.log=(text)=>{writeFileSync(${JSON.stringify(join(root, 'ready.json'))},text);setInterval(()=>{},1000);};`);
    const run = command(process.execPath, ['--import', preload, join(root, 'dist/runtime.js'), 'start', '--project', directory, '--port', process.env.CLAPGRID_FAULT_PORT!], { timeout: 8000 });
    await run;
    throw Error('不应收到就绪回执');
  }
  if (mode === 'startup-partial') {
    const socket = createServer();
    cleanup.connection(() => ({ close: () => new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve())) }));
    socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
    await cleanup.startService({ projectDirectory: directory, panelDirectory: root, port: (socket.address() as import('node:net').AddressInfo).port });
    throw Error('不应在被占用端口启动成功');
  }
  const business = openBusiness(directory, { key: () => 'controlled', configPath: 'controlled', fetch: async () => new Promise<Response>(() => {}) });
  cleanup.business(() => business);
  const independent = openBusiness(join(root, 'independent'));
  cleanup.business(() => independent);
  const close = independent.close;
  vi.spyOn(independent, 'close').mockImplementation(async () => { await close(); record('independent-closed.json', true); });
  if (mode === 'cleanup-failure' || mode === 'cleanup-stall') {
    vi.spyOn(business, 'close').mockImplementation(() => mode === 'cleanup-stall' ? new Promise<void>(() => {}) : Promise.reject(Error('受控业务关闭失败')));
    throw Error('原始测试失败');
  }
  if (mode === 'unknown-owner') {
    cleanup.process({ ...known, pidNamespace: 'unknown-namespace' });
    throw Error('原始测试失败');
  }
  if (mode === 'command-cleanup-failure') {
    unconfirmed = command(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 100 });
    const pid = unconfirmed.child.pid;
    vi.spyOn(process, 'kill').mockImplementation((target, signal) => target === pid && (signal === 'SIGTERM' || signal === 'SIGKILL') ? true : kill(target, signal));
    await unconfirmed;
    throw Error('不应确认命令已退出');
  }
  if (mode === 'refuse-term') {
    const code = `process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000);`;
    await command(process.execPath, ['-e', code], { timeout: 150 });
    throw Error('不应完成拒绝终止命令');
  }
  const segment = business.addSegment('任务永不完成').segments[0]!;
  business.submitSpeech({ requestId: '11111111-1111-4111-8111-111111111111', segmentId: segment.id });
  record('ready.json', true);
  await expect.poll(() => business.getSpeechStatus().locked, { timeout: 5000, message: '配音任务未结束' }).toBe(false);
});
