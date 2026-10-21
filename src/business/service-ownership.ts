import { ServiceCleanupError } from '../service-cleanup.js';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { projectPaths } from './project-paths.js';

// 未确认释放的保护必须强引用至进程退出，不能随失败 Promise 被 GC 自动解锁。
const heldOwnership = new Set<() => void>();

/** 用操作系统管理的 SQLite 文件锁保证同一规范路径只有一个服务，进程退出自动释放。 */
export function claimProjectService(directory: string) {
  const { projectDirectory } = projectPaths(directory);
  const ownership = new DatabaseSync(join(projectDirectory, 'service-owner.sqlite'));
  let released = false;
  const release = () => {
    if (released) return;
    ownership.close();
    released = true;
    heldOwnership.delete(release);
  };
  heldOwnership.add(release);
  try {
    // 独立于项目数据事务和普通修改权，不将长期服务锁施加到业务数据库。
    // 首次创建时给 SQLite 有限等待时间完成建库与锁升级。
    ownership.exec('PRAGMA busy_timeout = 1000; BEGIN EXCLUSIVE');
  } catch (error) {
    const original = new Error('项目已由另一服务打开，不能通过其他端口重复打开；请连接原服务。', { cause: error });
    try { release(); }
    catch (cleanup) { throw new ServiceCleanupError([original, cleanup], false, directory, '项目保护初始化失败'); }
    throw original;
  }
  return release;
}
