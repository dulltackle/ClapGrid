import { AsyncLocalStorage } from 'node:async_hooks';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { TestContext } from 'vitest';
import { rm } from 'node:fs/promises';
import type { openBusiness } from '../../src/business/index.js';
import { startService } from '../../src/service/server.js';
import type { command } from './command.js';

const { stopOwnedProcess, processIdentity } = await import(new URL('./product-process.mjs', import.meta.url).href);

// 仅为具体命令资源区分测试体和独立清理信号，避免旧异步链借用清理预算。
export const commandContext = new AsyncLocalStorage<{ context: TestContext; cleanup: boolean }>();

/** 本例具体项目资源共用一次原生清理钩子；目录删除显式依赖全部关闭／退出成功。 */
export function projectCleanup(t: TestContext) {
  let resources = projects.get(t);
  if (resources) return resources;
  let cleaning = false;
  const cleanupAbort = new AbortController();
  const directories = new Set<string>();
  const businesses: (() => Pick<ReturnType<typeof openBusiness>, 'close'> | undefined)[] = [];
  const services: (() => { close(): unknown } | Promise<{ close(): unknown }> | undefined)[] = [];
  const connections: (() => { close(): unknown } | undefined)[] = [];
  const processes: any[] = [];
  const commands: ReturnType<typeof command>[] = [];
  resources = {
    get signal() { return cleanupAbort.signal; },
    connectMcp(client: Client, transport: StdioClientTransport) {
      connections.push(() => client);
      const connected = client.connect(transport);
      const owner = transport.pid && processIdentity(transport.pid);
      if (owner) processes.push(owner);
      return connected;
    },
    startService(options: Parameters<typeof startService>[0]) {
      if (!commandContext.getStore()?.cleanup) t.signal.throwIfAborted();
      const pending = startService(options);
      services.push(() => pending);
      // 即使测试在就绪前超时，后来返回的服务也必须关闭；本轮钩子仍独立确认结果。
      void pending.then(service => { if (cleaning || t.signal.aborted) return service.close(); }).catch(() => {});
      return pending;
    },
    directory(path: string) { directories.add(path); },
    business(read: () => Pick<ReturnType<typeof openBusiness>, 'close'> | undefined) { businesses.push(read); },
    service(read: () => { close(): unknown } | undefined) { services.push(read); },
    connection(read: () => { close(): unknown } | undefined) { connections.push(read); },
    process(owner: unknown) { processes.push(owner); },
    command(child: ReturnType<typeof command>) { commands.push(child); },
  };
  projects.set(t, resources);
  t.onTestFinished(() => commandContext.run({ context: t, cleanup: true }, async () => {
    // 每例总计 8 秒；并行尝试独立资源，一处失败不阻止其余资源获得机会。
    cleaning = true;
    const started = Date.now();
    const deadline = started + 8000;
    const abortTimer = setTimeout(() => cleanupAbort.abort(Error('项目清理预算耗尽')), 8000);
    try {
      const close = async (label: string, run: () => unknown, until = deadline) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([Promise.resolve().then(run), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(Error(`${label} 关闭未确认；保留目录 ${[...directories].join(', ')}`)), Math.max(1, until - Date.now()));
          })]);
        } finally { clearTimeout(timer); }
      };
      // 连接释放依赖服务在线；服务关闭后才做进程兜底。每阶段留出后续尝试的预算。
      const results = [
        ...await Promise.allSettled(connections.map((read, i) => close(`项目连接 ${i}`, () => read()?.close(), started + 2000))),
        ...await Promise.allSettled([
          ...businesses.map((read, i) => close(`项目业务 ${i}`, () => read()?.close(), deadline - 2000)),
          ...services.map((read, i) => close(`项目服务 ${i}`, async () => (await read())?.close(), deadline - 2000)),
        ]),
        ...await Promise.allSettled([
          ...processes.map(owner => close(`服务进程 ${owner?.pid}`, () => stopOwnedProcess(owner))),
          ...commands.map((child, i) => close(`项目命令 ${i} PID=${child.child.pid}`, () => child.stop())),
        ]),
      ];
      const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (failures.length) throw new AggregateError(failures, `项目清理失败：${failures.map(error => String(error)).join('；')}；保留目录 ${[...directories].join(', ')}`);
      const removed = await Promise.allSettled([...directories].map(directory => close(`项目目录 ${directory}`, () => rm(directory, { recursive: true, force: true }))));
      const removalFailures = removed.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (removalFailures.length) throw new AggregateError(removalFailures, `目录清理未完成：${[...directories].join(', ')}`);
    } finally {
      clearTimeout(abortTimer);
      cleanupAbort.abort(Error('项目清理已结束，不再启动命令'));
    }
  }), 9000);
  return resources;
}
const projects = new WeakMap<TestContext, {
  readonly signal: AbortSignal;
  connectMcp(client: Client, transport: StdioClientTransport): Promise<void>;
  startService(options: Parameters<typeof startService>[0]): ReturnType<typeof startService>;
  directory(path: string): void;
  business(read: () => Pick<ReturnType<typeof openBusiness>, 'close'> | undefined): void;
  service(read: () => { close(): unknown } | undefined): void;
  connection(read: () => { close(): unknown } | undefined): void;
  process(owner: unknown): void;
  command(child: ReturnType<typeof command>): void;
}>();
