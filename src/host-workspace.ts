import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

/** 只查询宿主已保存的聊天，不创建、恢复聊天或请求模型。 */
export function readHostWorkspace(threadId: string): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(threadId)) return Promise.reject(new Error('缺少有效的宿主聊天身份，请重新打开 ClapGrid。'));
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CLAPGRID_CODEX_BIN ?? 'codex', ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let settled = false;
    const finish = (error?: Error, directory?: string) => {
      if (settled) return;
      settled = true; clearTimeout(timer); lines.close(); child.stdin.destroy(); child.kill();
      if (error) reject(error); else resolve(directory!);
    };
    const timer = setTimeout(() => finish(new Error('无法核对当前工作空间，请关闭重开 ClapGrid。')), 8000);
    const lines = createInterface({ input: child.stdout });
    const send = (value: unknown) => child.stdin.write(`${JSON.stringify(value)}\n`);
    child.on('error', () => finish(new Error('无法启动宿主工作空间查询，请检查 Codex 本地运行环境。')));
    child.on('exit', () => { if (!settled) finish(new Error('宿主工作空间查询已断开。')); });
    child.stdin.on('error', () => finish(new Error('宿主工作空间查询已断开。')));
    lines.on('line', line => {
      try {
        const message = JSON.parse(line);
        if (message.id === 1) {
          if (message.error) throw new Error('宿主不支持工作空间查询。');
          send({ method: 'initialized', params: {} });
          send({ id: 2, method: 'thread/read', params: { threadId, includeTurns: false } });
        } else if (message.id === 2) {
          const thread = message.result?.thread;
          if (message.error || thread?.id !== threadId || typeof thread.cwd !== 'string' || !isAbsolute(thread.cwd)) {
            throw new Error('无法取得本地工作空间，请先选择或创建工作空间。');
          }
          const directory = realpathSync(thread.cwd);
          if (!statSync(directory).isDirectory()) throw new Error('请先选择或创建本地工作空间。');
          finish(undefined, directory);
        }
      } catch { finish(new Error('无法核对本地工作空间，请先选择或创建工作空间并重新打开 ClapGrid。')); }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'clapgrid-workspace', version: '0.1.0' } } });
  });
}

export function hostThreadId(meta: Record<string, unknown> | undefined): string {
  const direct = meta?.threadId;
  let nested = meta?.['x-codex-turn-metadata'];
  if (typeof nested === 'string') { try { nested = JSON.parse(nested); } catch { throw new Error('宿主聊天身份无效。'); } }
  const fallback = nested && typeof nested === 'object' ? (nested as Record<string, unknown>).thread_id : undefined;
  if (direct && fallback && direct !== fallback) throw new Error('宿主聊天身份不一致，请重新打开。');
  const id = direct ?? fallback;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('宿主未提供聊天身份，不能连接项目。');
  return id;
}
