import assert from 'node:assert/strict';

const { processIdentity, ownerAlive } = await import(new URL('../../scripts/verification-jobs.mjs', import.meta.url).href);

export function serviceProcess(pid: number) {
  const identity = processIdentity(pid);
  assert.ok(identity, `服务进程 ${pid} 已不可读取`);
  return identity;
}

/** 端口关闭早于数据库和媒体守护进程清理；确认原进程退出后才能移除项目目录。 */
export async function waitForServiceExit(identity: ReturnType<typeof serviceProcess>, { timeoutMs = 10000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (ownerAlive(identity) !== false) {
    if (Date.now() >= deadline) throw new Error(`服务进程 ${identity.pid} 尚未确认退出，保留清理现场`);
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}
