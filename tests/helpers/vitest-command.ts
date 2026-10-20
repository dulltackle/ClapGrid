import { aroundEach } from 'vitest';
import { projectCleanup, commandContext } from './project-cleanup.js';
import { command as startCommand } from './command.js';

aroundEach((runTest, t) => commandContext.run({ context: t, cleanup: false }, runTest));

export function command(file: string, args: readonly string[], options: Parameters<typeof startCommand>[2] = {}) {
  const scope = commandContext.getStore();
  const context = scope?.context;
  const signal = context && (scope!.cleanup ? projectCleanup(context).signal : context.signal);
  const run = startCommand(file, args, { signal, ...options });
  if (context) projectCleanup(context).command(run);
  return run;
}
export function execCommand(file: string, args: readonly string[], options: Parameters<typeof startCommand>[2] = {}) {
  const run = command(file, args, options);
  return Object.assign(run.then(result => {
    if (result.status !== 0) throw Object.assign(Error(`${file} 退出 ${result.status}: ${result.stderr}`), result);
    return result;
  }), { child: run.child });
}
export async function execText(file: string, args: readonly string[], options: Parameters<typeof startCommand>[2] & { encoding: string }) {
  return (await execCommand(file, args, options)).stdout;
}
export async function execBytes(file: string, args: readonly string[], options: Parameters<typeof startCommand>[2] = {}) {
  // 用 latin1 无损收集媒体字节，避免 UTF-8 替换二进制内容。
  return Buffer.from((await execCommand(file, args, { ...options, encoding: 'latin1' })).stdout, 'latin1');
}
