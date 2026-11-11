import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export const projectFormatVersion = 2;

/** 用户指定根目录可使用别名；项目内部的存储入口不能链接至其他位置。 */
export function projectPaths(directory: string) {
  const reservation = join(dirname(resolve(directory)), `.${basename(resolve(directory))}-import`);
  const assertNotImporting = () => { if (existsSync(reservation)) throw new Error('项目正在迁入或迁入曾中断，请检查迁入现场后重新打开。'); };
  assertNotImporting();
  mkdirSync(directory, { recursive: true });
  assertNotImporting();
  const projectDirectory = realpathSync(directory);
  const verify = () => {
    if (realpathSync(projectDirectory) !== projectDirectory) throw new Error('项目根路径已改变，请重新打开。');
    for (const name of ['service.json', 'clapgrid.sqlite', 'clapgrid.sqlite-wal', 'clapgrid.sqlite-shm', 'clapgrid.sqlite-journal', 'media', 'exports', 'pages', 'styles', 'service.log', 'media-active.json', 'media-owner.sqlite', 'media-owner.sqlite-journal', 'media-owner.sqlite-wal', 'media-owner.sqlite-shm', 'service-owner.sqlite', 'service-owner.sqlite-journal', 'service-owner.sqlite-wal', 'service-owner.sqlite-shm']) {
      const stat = lstatSync(join(projectDirectory, name), { throwIfNoEntry: false });
      if (stat && (stat.isSymbolicLink() || ((name === 'media' || name === 'exports' || name === 'pages' || name === 'styles') ? !stat.isDirectory() : !stat.isFile() || stat.nlink > 1))) {
        throw new Error(`项目存储路径不安全：${name}，请使用项目内的普通文件或目录。`);
      }
    }
  };
  verify();
  const database = join(projectDirectory, 'clapgrid.sqlite');
  if (existsSync(database)) {
    // 建库时在启用 WAL 前提交 user_version。只读文件头，避免旧项目产生 WAL/SHM。
    const fd = openSync(database, constants.O_RDONLY | constants.O_NOFOLLOW);
    const header = Buffer.alloc(64);
    try { readSync(fd, header, 0, header.length, 0); } finally { closeSync(fd); }
    if (header.toString('ascii', 0, 16) !== 'SQLite format 3\0') throw new Error('项目数据库格式无效');
    const version = header.readUInt32BE(60);
    if (version < 1) throw new Error('项目格式过旧，请新建项目');
    if (version > projectFormatVersion) throw new Error('项目格式更新，请升级 ClapGrid');
  }
  return { projectDirectory, database, mediaDirectory: join(projectDirectory, 'media'), verify };
}
