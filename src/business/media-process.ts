import { mediaScope } from './media-guardian.js';
import { spawn } from 'node:child_process';

/** 取消必须等 close：收到 AbortError 不代表子进程已经停止写文件。 */
export function mediaProcess(command: string, args: string[], options: { signal?: AbortSignal; cwd?: string; timeout?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  const guardian = mediaScope.getStore();
  if (guardian) return guardian(command, args, options);
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let failure: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      child.kill('SIGTERM');
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), 2000);
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
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(killTimer); options.signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`${command} 处理失败：${stderr.trim().slice(-1500) || `退出码 ${code}`}`));
      else resolve({ stdout, stderr });
    });
  });
}
