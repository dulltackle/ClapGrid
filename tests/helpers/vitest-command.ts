import { AsyncLocalStorage } from 'node:async_hooks';
import type { createProjectResources } from './project-resources.js';
import { command as startCommand } from './command.js';

// 原生命令 fixture 和协调者收尾分别提供独立信号；旧异步链保留测试信号。
export const commandContext = new AsyncLocalStorage<{ owner: ReturnType<typeof createProjectResources>; signal: AbortSignal }>();

export function createCommands(owner: ReturnType<typeof createProjectResources>, testSignal: AbortSignal) {
  function command(file: string, args: readonly string[], options: Parameters<typeof startCommand>[2] = {}) {
    const scope = commandContext.getStore();
    const signal = scope?.owner === owner ? scope.signal : testSignal;
    const run = startCommand(file, args, { signal, ...options });
    owner.command(run);
    return run;
  }
  function execCommand(file: string, args: readonly string[], options: Parameters<typeof startCommand>[2] = {}) {
    const run = command(file, args, options);
    return Object.assign(run.then(result => {
      if (result.status !== 0) throw Object.assign(Error(`${file} 退出 ${result.status}: ${result.stderr}`), result);
      return result;
    }), { child: run.child });
  }
  async function execText(file: string, args: readonly string[], options: Parameters<typeof startCommand>[2] & { encoding: string }) {
    return (await execCommand(file, args, options)).stdout;
  }
  async function execBytes(file: string, args: readonly string[], options: Parameters<typeof startCommand>[2] = {}) {
    // 用 latin1 无损收集媒体字节，避免 UTF-8 替换二进制内容。
    return Buffer.from((await execCommand(file, args, { ...options, encoding: 'latin1' })).stdout, 'latin1');
  }

  return { command, execCommand, execText, execBytes };
}
