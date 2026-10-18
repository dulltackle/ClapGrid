import { execFileSync, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 包安装只共享读取视图；执行器的顶层可写目录始终属于本次夹具。 */
export function dependencyView(root: string, dependencies: string) {
  const target = join(root, 'node_modules');
  mkdirSync(target);
  const writableCaches = ['.cache', '.vite', '.vite-temp', '.vitest-cache'];
  // 启动前固定本地缓存拓扑，避免首次写入改变构建输入或跟随共享安装。
  for (const cache of writableCaches) mkdirSync(join(target, cache));
  for (const name of readdirSync(dependencies)) {
    if (writableCaches.includes(name)) continue;
    symlinkSync(join(dependencies, name), join(target, name));
  }
}

/** 同步启动边界使用；异步工作通过 fixture.environment 传入独立环境。 */
export function withEnvironment<T>(values: NodeJS.ProcessEnv, work: () => T): T {
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    return work();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

export function temporaryRepository(onCleanup: (cleanup: () => Promise<void>) => void, options: {
  project: string; dependencies?: string; prefix?: string; scriptBase?: string;
  beforeRemove?: (root: string) => void;
}) {
  const root = mkdtempSync(join(tmpdir(), options.prefix ?? 'clapgrid-repository-'));
  const environment = (overrides: NodeJS.ProcessEnv = {}) => ({ ...process.env, NODE_TEST_CONTEXT: undefined, ...overrides });
  const workers: Array<{ child: ChildProcess; closed: Promise<number | null> }> = [];
  const own = (child: ChildProcess) => {
    const closed = child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve(child.exitCode) : new Promise<number | null>(resolve => child.once('close', resolve));
    workers.push({ child, closed }); return closed;
  };
  let removed = false;
  const cleanup = async () => {
    if (removed) return;
    // 等待原 child 的 close，随后通过原生命周期入口核对全部登记后代；失败保留根目录。
    for (const { child, closed } of workers) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([closed, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Error(`保留未确认清理的fixture：${root}；子进程未退出`)), 15000);
        })]);
      } finally { clearTimeout(timer); }
    }
    if (existsSync(join(root, 'logs/check-state/active'))) {
      const stop = spawnSync(process.execPath, ['scripts/check-lifecycle.mjs'], { cwd: root, env: environment(), encoding: 'utf8', timeout: 15000 });
      if (stop.status !== 0 || existsSync(join(root, 'logs/check-state/active'))) {
        throw Error(`保留未确认清理的fixture：${root}\n${stop.stderr}`);
      }
    }
    options.beforeRemove?.(root);
    rmSync(root, { recursive: true, force: true }); removed = true;
  };
  onCleanup(cleanup);
  const put = (file: string, text: string) => { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), text); };
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q');
  cpSync(join(options.scriptBase ?? options.project, 'scripts'), join(root, 'scripts'), { recursive: true });
  dependencyView(root, options.dependencies ?? join(options.project, 'node_modules'));
  return { root, put, git, own, cleanup, environment };
}
