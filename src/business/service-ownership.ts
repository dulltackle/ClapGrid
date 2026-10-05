import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { projectPaths } from './project-paths.js';

/** 用操作系统管理的 SQLite 文件锁保证同一规范路径只有一个服务，进程退出自动释放。 */
export function claimProjectService(directory: string) {
  const { projectDirectory } = projectPaths(directory);
  const ownership = new DatabaseSync(join(projectDirectory, 'service-owner.sqlite'));
  try {
    // 独立于项目数据事务和普通修改权，不将长期服务锁施加到业务数据库。
    // 首次创建所有权数据库时，两个启动进程可能同时取得临时读锁；
    // 给 SQLite 有限等待时间完成建库与锁升级，避免双方都立即失败。
    ownership.exec('PRAGMA busy_timeout = 1000; BEGIN EXCLUSIVE');
  } catch {
    ownership.close();
    throw new Error('项目已由另一服务打开，不能通过其他端口重复打开；请连接原服务。');
  }
  return () => ownership.close();
}
