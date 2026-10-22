import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { TestContext } from 'vitest';
import { rm } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { openBusiness } from '../../src/business/index.js';
import { startService } from '../../src/service/server.js';
import type { command } from './command.js';

const { stopOwnedProcess, processIdentity } = await import(new URL('./product-process.mjs', import.meta.url).href);

/** 每例只有一个协调者；原生 fixture 拥有其创建和最终释放。 */
export function createProjectResources(t: Pick<TestContext, 'signal'>) {
  let cleaning = false;
  const cleanupAbort = new AbortController();
  const directories = new Set<string>();
  const businesses: (() => Pick<ReturnType<typeof openBusiness>, 'close'> | undefined)[] = [];
  const services: (() => { close(): unknown } | Promise<{ close(): unknown }> | undefined)[] = [];
  const connections: (() => { close(): unknown } | Promise<{ close(): unknown }> | undefined)[] = [];
  const processes: any[] = [];
  const commands: ReturnType<typeof command>[] = [];
  const resources = {
    get signal() { return cleanupAbort.signal; },
    connectMcp(client: Client, transport: StdioClientTransport) {
      connections.push(() => client);
      const connected = client.connect(transport);
      const owner = transport.pid && processIdentity(transport.pid);
      if (owner) processes.push(owner);
      return connected;
    },
    startService(options: Parameters<typeof startService>[0]) {
      t.signal.throwIfAborted();
      const pending = startService(options);
      services.push(() => pending);
      // 即使测试在就绪前超时，后来返回的服务也必须关闭；本轮钩子仍独立确认结果。
      void pending.then(service => { if (cleaning || t.signal.aborted) return service.close(); }).catch(() => {});
      return pending;
    },
    createDirectory(create: string | (() => string)) {
      const path = typeof create === 'string' ? mkdtempSync(create) : create();
      directories.add(String(path));
      return path;
    },
    openBusiness(...args: Parameters<typeof openBusiness>) {
      const business = openBusiness(...args);
      businesses.push(() => business);
      return business;
    },
    openConnection<T extends { close(): unknown } | Promise<{ close(): unknown }>>(create: () => T): T {
      const connection = create();
      connections.push(() => connection);
      void Promise.resolve(connection).then(value => { if (cleaning || t.signal.aborted) return value.close(); }).catch(() => {});
      return connection;
    },
    ownService(create: () => { close(): unknown }) {
      const service = create();
      services.push(() => service);
      return service;
    },
    ownProcess(create: () => unknown) {
      const owner = create();
      processes.push(owner);
      return owner;
    },
    command(child: ReturnType<typeof command>) { commands.push(child); },
  };
  const cleanup = async () => {
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
        ...await Promise.allSettled(connections.map((read, i) => close(`项目连接 ${i}`, async () => (await read())?.close(), started + 2000))),
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
  };
  return { ...resources, cleanup };
}