import { test, expect } from 'vitest';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';

const { processIdentity, ownerAlive, stopOwnedProcess } = await import(new URL('./helpers/product-process.mjs', import.meta.url).href);

// 保持事件循环同步阻塞，等待子进程变为僵尸但尚未由 Node 回收。
function waitForZombie(pid: number) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    if (stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z ')) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  throw Error('测试子进程未进入僵尸状态');
}

for (const state of ['已退出', '核对期间退出', '仍存活'] as const) {
  test.skipIf(process.platform !== 'linux')(`命名空间权限变化：${state}的拥有者得到正确退出结论`, async () => {
    const child = spawn(process.execPath, ['-e', 'console.log("ready"); setInterval(() => {}, 1000);']);
    const exited = once(child, 'exit');
    const originalReadlink = fs.readlinkSync;
    try {
      await once(child.stdout!, 'data');
      const owner = processIdentity(child.pid!);
      expect(ownerAlive(owner)).toBe(true);
      if (state === '已退出') { child.kill('SIGKILL'); waitForZombie(child.pid!); }
      // 注入 CI 的权限错误，进程状态及退出仍由真实 /proc 与真实子进程提供。
      fs.readlinkSync = ((...args: Parameters<typeof fs.readlinkSync>) => {
        if (args[0] === `/proc/${child.pid}/ns/pid`) {
          if (state === '核对期间退出') { child.kill('SIGKILL'); waitForZombie(child.pid!); }
          throw Object.assign(Error('命名空间不可读'), { code: 'EACCES' });
        }
        return originalReadlink(...args);
      }) as typeof fs.readlinkSync;
      syncBuiltinESMExports();
      if (state === '仍存活') {
        expect(ownerAlive(owner)).toBeNull();
        await expect(stopOwnedProcess(owner)).rejects.toThrow(/身份不明/);
        expect(child.exitCode).toBeNull();
      } else {
        expect(ownerAlive(owner)).toBe(false);
      }
    } finally {
      fs.readlinkSync = originalReadlink;
      syncBuiltinESMExports();
      child.kill('SIGKILL');
      await exited;
    }
  });
}
