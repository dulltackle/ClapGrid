import { createHash, randomUUID } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, readFileSync, lstatSync, realpathSync, readdirSync, mkdirSync, writeFileSync, renameSync, rmSync, existsSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const pageLimits = { files: 256, bytes: 32 * 1024 * 1024 } as const;
const extensions = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.woff2', '.ttf', '.otf']);
export const pageIdPattern = /^[a-f0-9]{64}$/;

function ordinaryDirectory(path: string) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('页面目录不能是符号链接或特殊文件');
}
function readTree(root: string) {
  ordinaryDirectory(root);
  const files = new Map<string, Buffer>(); let bytes = 0;
  function walk(directory: string) {
    ordinaryDirectory(directory);
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name); const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error('页面拒绝符号链接');
      if (stat.isDirectory()) { walk(path); continue; }
      if (!stat.isFile() || stat.nlink !== 1) throw new Error('页面拒绝多硬链接和特殊文件');
      if (!extensions.has(extname(name).toLowerCase())) throw new Error(`页面文件类型不允许：${name}`);
      if (files.size >= pageLimits.files || bytes + stat.size > pageLimits.bytes) throw new Error('页面超过上限：256 个文件、32 MiB');
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const current = fstatSync(fd);
        if (!current.isFile() || current.nlink !== 1 || current.ino !== stat.ino || current.dev !== stat.dev || current.size !== stat.size) throw new Error('页面文件在读取期间改变');
        const content = readFileSync(fd); bytes += content.length;
        if (bytes > pageLimits.bytes) throw new Error('页面超过总大小上限 32 MiB');
        files.set(relative(root, path).split(sep).join('/'), content);
      } finally { closeSync(fd); }
    }
    if (realpathSync(directory) !== directory) throw new Error('页面目录包含目录外引用');
  }
  walk(root);
  if (!files.has('index.html')) throw new Error('页面必须包含 index.html');
  const digest = createHash('sha256');
  for (const [name, content] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    digest.update(JSON.stringify([name, content.length]) + '\n').update(content);
  }
  return { files, pageId: digest.digest('hex'), fileCount: files.size, bytes };
}

/** 内容身份同时是完整性检查；渲染只使用已核对的字节快照。 */
export function pageStore(projectDirectory: string) {
  const root = join(projectDirectory, 'pages');
  function read(pageId: string) {
    if (!pageIdPattern.test(pageId)) throw new Error('页面身份无效');
    ordinaryDirectory(root);
    const path = join(root, pageId);
    if (!existsSync(path)) throw new Error('页面不存在，请先导入页面');
    const page = readTree(path);
    if (page.pageId !== pageId) throw new Error('页面副本已改变，请重新导入页面');
    return page;
  }
  return {
    read,
    import(sourceDirectory: string, workspaceDirectory: string) {
      if (!isAbsolute(sourceDirectory)) throw new Error('页面源目录必须是工作空间内的绝对路径');
      const workspace = realpathSync(workspaceDirectory); const source = resolve(sourceDirectory);
      const within = relative(workspace, source);
      if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error('页面源目录必须位于工作空间内');
      for (let path = source; path !== workspace; path = dirname(path)) ordinaryDirectory(path);
      const page = readTree(source);
      mkdirSync(root, { recursive: true }); ordinaryDirectory(root);
      const target = join(root, page.pageId);
      if (existsSync(target)) read(page.pageId);
      else {
        const temporary = join(root, `.import-${randomUUID()}`); mkdirSync(temporary);
        try {
          for (const [name, content] of page.files) {
            const path = join(temporary, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content, { flag: 'wx', mode: 0o444 });
          }
          renameSync(temporary, target);
        } finally { rmSync(temporary, { recursive: true, force: true }); }
      }
      return { pageId: page.pageId, fileCount: page.fileCount, bytes: page.bytes };
    },
  };
}
