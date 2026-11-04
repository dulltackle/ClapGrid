import { readdirSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { mediaScope } from './media-guardian.js';
import { spawn } from 'node:child_process';

/** 取消必须等 close：收到 AbortError 不代表子进程已经停止写文件。 */
export function mediaProcess(command: string, args: string[], options: { signal?: AbortSignal; cwd?: string; timeout?: number; processGroup?: boolean } = {}): Promise<{ stdout: string; stderr: string }> {
  const guardian = mediaScope.getStore();
  if (guardian) return guardian(command, args, options);
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: options.processGroup && process.platform === 'linux' });
    let stdout = ''; let stderr = ''; let failure: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      try { if (options.processGroup && process.platform === 'linux' && child.pid) process.kill(-child.pid, signal); else child.kill(signal); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    };
    const stop = () => {
      kill('SIGTERM');
      killTimer ??= setTimeout(() => kill('SIGKILL'), 2000);
    };
    const abort = () => { failure = new Error('操作已取消'); stop(); };
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { failure = new Error('媒体处理超时'); stop(); }, options.timeout ?? 10 * 60 * 1000);
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      if (stdout.length > 8 * 1024 * 1024) { failure = new Error('媒体探测输出过大'); stop(); }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-32768); });
    child.on('error', error => { failure = error; });
    child.on('close', async code => {
      clearTimeout(timer); clearTimeout(killTimer); options.signal?.removeEventListener('abort', abort);
      if (options.processGroup && process.platform === 'linux' && child.pid) {
        // 主进程异常退出也不允许遗留浏览器后代；锁一直保持到组内活进程退出。
        const alive = () => readdirSync('/proc').some(name => {
          if (!/^\d+$/.test(name)) return false;
          try { const value = readFileSync(`/proc/${name}/stat`, 'utf8'); const fields = value.slice(value.lastIndexOf(')') + 2).split(' '); return Number(fields[2]) === child.pid && fields[0] !== 'Z'; }
          catch (error) { if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) return false; throw error; }
        });
        try {
          if (alive()) {
            kill('SIGTERM'); const deadline = Date.now() + 2000;
            while (alive()) { if (Date.now() >= deadline) kill('SIGKILL'); await delay(20); }
          }
        } catch (error) { reject(error); return; }
      }
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`${command} 处理失败：${stderr.trim().slice(-1500) || `退出码 ${code}`}`));
      else resolve({ stdout, stderr });
    });
  });
}
