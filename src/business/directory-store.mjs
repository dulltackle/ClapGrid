import { createHash, randomUUID } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, readFileSync, lstatSync, realpathSync, readdirSync, mkdirSync, writeFileSync, renameSync, rmSync, existsSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const directoryLimits = { files: 256, bytes: 32 * 1024 * 1024 };
const extensions = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.woff2', '.ttf', '.otf', '.md']);
export const contentIdPattern = /^[a-f0-9]{64}$/;

/** @param {string} path @param {string} label */
function ordinaryDirectory(path, label) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label}不能是符号链接或特殊文件`);
}
/** @param {string} root @param {string} label */
function readTree(root, label) {
  ordinaryDirectory(root, label);
  const files = /** @type {Map<string, Buffer>} */ (new Map()); let bytes = 0;
  /** @param {string} directory */
  function walk(directory) {
    ordinaryDirectory(directory, label);
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name); const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`${label}拒绝符号链接`);
      if (stat.isDirectory()) { walk(path); continue; }
      if (!stat.isFile() || stat.nlink !== 1) throw new Error(`${label}拒绝多硬链接和特殊文件`);
      if (!extensions.has(extname(name).toLowerCase())) throw new Error(`内容目录文件类型不允许：${name}`);
      if (files.size >= directoryLimits.files || bytes + stat.size > directoryLimits.bytes) throw new Error(`${label}超过上限：256 个文件、32 MiB`);
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const current = fstatSync(fd);
        if (!current.isFile() || current.nlink !== 1 || current.ino !== stat.ino || current.dev !== stat.dev || current.size !== stat.size) throw new Error(`${label}文件在读取期间改变`);
        const content = readFileSync(fd); bytes += content.length;
        if (bytes > directoryLimits.bytes) throw new Error(`${label}超过总大小上限 32 MiB`);
        files.set(relative(root, path).split(sep).join('/'), content);
      } finally { closeSync(fd); }
    }
    if (realpathSync(directory) !== directory) throw new Error(`${label}包含目录外引用`);
  }
  walk(root);
  const digest = createHash('sha256');
  for (const [name, content] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    digest.update(JSON.stringify([name, content.length]) + '\n').update(content);
  }
  return { files, contentId: digest.digest('hex'), fileCount: files.size, bytes };
}

/** 内容身份同时是完整性检查；渲染只使用已核对的字节快照。 */
/** @param {string} projectDirectory @param {string} collection @param {(files: Map<string, Buffer>) => void} validate @param {string} label */
export function directoryStore(projectDirectory, collection, validate, label) {
  const root = join(projectDirectory, collection);
  /** @param {string} contentId */
  function read(contentId) {
    if (!contentIdPattern.test(contentId)) throw new Error(`${label}身份无效`);
    ordinaryDirectory(root, label);
    const path = join(root, contentId);
    if (!existsSync(path)) throw new Error(`${label}不存在，请先导入${label}`);
    const page = readTree(path, label); validate(page.files);
    if (page.contentId !== contentId) throw new Error(`${label}副本已改变，请重新导入${label}`);
    return page;
  }
  return {
    read,
    /** @param {string} sourceDirectory @param {string} workspaceDirectory */
    import(sourceDirectory, workspaceDirectory) {
      if (!isAbsolute(sourceDirectory)) throw new Error(`${label}源目录必须是工作空间内的绝对路径`);
      const workspace = realpathSync(workspaceDirectory); const source = resolve(sourceDirectory);
      const within = relative(workspace, source);
      if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error(`${label}源目录必须位于工作空间内`);
      for (let path = source; path !== workspace; path = dirname(path)) ordinaryDirectory(path, label);
      const page = readTree(source, label); validate(page.files);
      mkdirSync(root, { recursive: true }); ordinaryDirectory(root, label);
      const target = join(root, page.contentId);
      if (existsSync(target)) read(page.contentId);
      else {
        const temporary = join(root, `.import-${randomUUID()}`); mkdirSync(temporary);
        try {
          for (const [name, content] of page.files) {
            const path = join(temporary, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content, { flag: 'wx', mode: 0o444 });
          }
          renameSync(temporary, target);
        } finally { rmSync(temporary, { recursive: true, force: true }); }
      }
      return { contentId: page.contentId, fileCount: page.fileCount, bytes: page.bytes };
    },
  };
}
