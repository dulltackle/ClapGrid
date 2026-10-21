import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SERVICE_CLEANUP_MS, beforeServiceDeadline, ServiceCleanupError } from '../service-cleanup.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

type Result = { stdout: string; stderr: string };
type Options = { signal?: AbortSignal; cwd?: string; timeout?: number };
type Runner = (command: string, args: string[], options: Options) => Promise<Result>;
export const mediaScope = new AsyncLocalStorage<Runner>();

/** 媒体锁直到所有子进程 close 才释放；服务崩溃后的 IPC 断开触发回收。 */
export async function startMediaGuardian(directory: string) {
  const source = import.meta.url.endsWith('.ts');
  const worker = fork(fileURLToPath(new URL(`../business/media-worker.${source ? 'ts' : 'js'}`, import.meta.url)), [directory], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'], execArgv: source ? ['--import', 'tsx'] : [],
  });
  let closed = false;
  let readyConfirmed = false;
  let stopping = false;
  const pending = new Map<string, { resolve: (value: Result) => void; reject: (error: Error) => void; cleanup: () => void }>();
  const ended = new Promise<boolean>(resolve => worker.once('exit', (code) => {
    closed = true;
    for (const item of pending.values()) { item.cleanup(); item.reject(new Error('媒体守护进程异常退出，无法确认子进程状态')); }
    pending.clear(); resolve(readyConfirmed && code === 0 && !existsSync(join(directory, 'media-active.json')));
  }));
  worker.on('message', (message: any) => {
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id); item.cleanup();
    if (message.error) item.reject(new Error(message.error)); else item.resolve(message.result);
  });
  const close = async (deadline = Date.now() + SERVICE_CLEANUP_MS) => {
    stopping = true;
    if (worker.connected) worker.disconnect();
    if (!await beforeServiceDeadline(deadline, '媒体守护进程退出', () => ended)) throw new Error('媒体守护进程异常退出，未确认媒体释放');
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); if (worker.connected) worker.disconnect(); reject(new Error('旧媒体进程尚未退出，暂不恢复项目；请检查 service.log')); }, 15000);
      const cleanup = () => { clearTimeout(timer); worker.off('message', ready); worker.off('exit', failed); worker.off('error', error); };
      const ready = (message: any) => { if (message.ready) { readyConfirmed = true; cleanup(); resolve(); } };
      const failed = () => { cleanup(); reject(new Error('媒体守护进程启动失败；项目未恢复')); };
      const error = (error: Error) => { cleanup(); reject(error); };
      worker.on('message', ready); worker.once('exit', failed); worker.once('error', error);
    });
  } catch (error) {
    // 失败的初始化也负责自己的子进程，不能把仍在退出的 worker 交给调用者猜测。
    try { await close(); }
    catch (cleanup) { throw new ServiceCleanupError([error, cleanup], false, directory, '媒体初始化失败'); }
    throw new ServiceCleanupError([error], true, directory, '媒体初始化失败');
  }
  const run: Runner = (command, args, options) => {
    options.signal?.throwIfAborted();
    if (closed || stopping) return Promise.reject(new Error('媒体服务已停止'));
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const abort = () => { if (worker.connected) worker.send({ abort: id }); };
      pending.set(id, { resolve, reject, cleanup: () => options.signal?.removeEventListener('abort', abort) });
      options.signal?.addEventListener('abort', abort, { once: true });
      worker.send({ id, command, args, options: { cwd: options.cwd, timeout: options.timeout } });
    });
  };
  return { run, verify() { if (closed && !stopping) throw new Error('媒体守护进程异常退出，项目仍锁定；需确认旧进程终止后恢复'); },
    close };
}
