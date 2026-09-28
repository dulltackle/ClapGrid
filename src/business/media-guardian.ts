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
  let stopping = false;
  const pending = new Map<string, { resolve: (value: Result) => void; reject: (error: Error) => void; cleanup: () => void }>();
  const ended = new Promise<void>(resolve => worker.once('exit', () => {
    closed = true;
    for (const item of pending.values()) { item.cleanup(); item.reject(new Error('媒体守护进程异常退出，无法确认子进程状态')); }
    pending.clear(); resolve();
  }));
  worker.on('message', (message: any) => {
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id); item.cleanup();
    if (message.error) item.reject(new Error(message.error)); else item.resolve(message.result);
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); if (worker.connected) worker.disconnect(); reject(new Error('旧媒体进程尚未退出，暂不恢复项目；请检查 service.log')); }, 15000);
    const cleanup = () => { clearTimeout(timer); worker.off('message', ready); worker.off('exit', failed); worker.off('error', error); };
    const ready = (message: any) => { if (message.ready) { cleanup(); resolve(); } };
    const failed = () => { cleanup(); reject(new Error('媒体守护进程启动失败；项目未恢复')); };
    const error = (error: Error) => { cleanup(); reject(error); };
    worker.on('message', ready); worker.once('exit', failed); worker.once('error', error);
  });
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
    async close() { stopping = true; if (worker.connected) worker.disconnect(); await ended; } };
}
