import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';

export function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trimEnd();
}

/** 跟踪文件与未忽略的新文件均计入；日志和构建输出沿用 Git 忽略规则。 */
export function sourceIdentity(root) {
  const files = [...new Set(git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean))].sort();
  const hash = createHash('sha256');
  for (const file of files) {
    const path = join(root, file);
    let stat;
    try { stat = lstatSync(path); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      hash.update(JSON.stringify([file, 'missing'])); continue;
    }
    if (!stat.isFile() && !stat.isSymbolicLink()) throw Error(`不支持的源码条目：${file}`);
    const contents = stat.isSymbolicLink() ? Buffer.from(readlinkSync(path)) : readFileSync(path);
    hash.update(JSON.stringify([file, stat.isSymbolicLink() ? 'link' : 'file', stat.mode & 0o111, contents.length]));
    hash.update(contents);
  }
  return { commit: git(root, ['rev-parse', 'HEAD']), tree: git(root, ['rev-parse', 'HEAD^{tree}']), fingerprint: `sha256:${hash.digest('hex')}`, dirty: git(root, ['status', '--porcelain', '--untracked-files=all']) !== '' };
}

export function sameSource(a, b) {
  return a.commit === b.commit && a.fingerprint === b.fingerprint;
}
