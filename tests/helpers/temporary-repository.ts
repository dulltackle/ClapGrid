import { mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

/** 包安装只共享读取视图；产品测试的顶层可写目录始终属于本次夹具。 */
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
