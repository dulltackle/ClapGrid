import { open, lstat, realpath, stat, readFile } from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import { resolve, relative, isAbsolute, sep, posix } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { productionSchema } from './schema.mjs';
import { failure, resolveProjectFile } from './common.mjs';
import { projectFileReferences } from './project-file-references.mjs';
import { parseV1, projectV1, v1Object, v1Integer, dumpV1 } from './archive-v1.mjs';
import { decodeArchiveGzip, strictArchiveTar } from './archive-streams.mjs';

const tar = createRequire(import.meta.url)('tar-stream');
const INDEX = '.clapgrid-package.json';
const CHUNK = 64 * 1024;
/** @typedef {{sha256:string,size:number}} Identity */
/** @typedef {{root:string,manifestName:string,members:Map<string,Identity>,indexBytes:Buffer}} ArchivePlan */
/** @param {string} root @param {string} file */
function within(root, file) {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
/** @param {unknown} input @returns {string} */
function memberName(input) {
  if (typeof input !== 'string' || !input || input.includes('\\') || input.includes('\0') || posix.isAbsolute(input) || input.split('/').includes('..') || posix.normalize(input) !== input || input.endsWith('/')) throw new Error(`制作成员必须是规范项目相对路径：${input}`);
  return input;
}
/** @param {import('node:fs').Stats|import('node:fs').BigIntStats} before @param {import('node:fs').Stats|import('node:fs').BigIntStats} after */
function sameFile(before, after) {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}

/** 实际读取时再次核对规范路径、普通文件、真实目标与打开句柄；前一次引用解释不代替此核对。
 * @param {string} root @param {string} name */
async function openMember(root, name) {
  memberName(name);
  const path = resolve(root, name);
  const before = await lstat(path);
  if (before.isSymbolicLink() || !before.isFile() || !within(root, await realpath(path))) throw new Error(`制作成员不是项目内普通文件：${name}`);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    const target = await realpath(path);
    const current = await lstat(path);
    if (!opened.isFile() || current.isSymbolicLink() || !within(root, target) || !sameFile(before, opened) || !sameFile(opened, current) || !sameFile(opened, await stat(target))) throw new Error(`制作成员读取前状态变化或越出项目：${name}`);
    return { handle, before: opened, path };
  } catch (error) { await handle.close(); throw error; }
}

/** @param {AsyncIterable<Buffer>} stream @returns {Promise<Identity>} */
async function identity(stream) {
  const sha = createHash('sha256');
  let size = 0;
  for await (const chunk of stream) { sha.update(chunk); size += chunk.length; }
  return { sha256: sha.digest('hex'), size };
}
/** @param {Buffer} bytes @returns {Identity} */
const bytesIdentity = bytes => ({ sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length });

/** @param {string} root @param {string} name */
async function sourceIdentity(root, name) {
  const source = await openMember(root, name);
  try {
    const result = await identity(source.handle.createReadStream({ highWaterMark: CHUNK, autoClose: false }));
    if (!sameFile(source.before, await source.handle.stat()) || !sameFile(source.before, await lstat(source.path)) || !within(root, await realpath(source.path))) throw new Error(`制作成员读取期间状态变化：${name}`);
    return result;
  } finally { await source.handle.close(); }
}

/** 原清单和索引身份、用途必需集合及文件状态一起准备；写包与核对共用同一 v1 规则。
 * @param {import('./common.mjs').CommandOptions} options @returns {Promise<ArchivePlan>} */
async function prepareArchive(options) {
  const root = await realpath(options.project);
  const manifestPath = await resolveProjectFile(root, options.manifest);
  const manifestName = relative(root, manifestPath).split(sep).join('/');
  if (manifestName === INDEX) throw new Error(`清单自身不能使用归档索引保留路径：${INDEX}`);
  const raw = await readFile(manifestPath);
  const ordered = v1Object(parseV1(raw));
  const manifest = productionSchema.parse(projectV1(ordered));
  const files = ordered.get('files');
  if (!Array.isArray(files) || !files.length) throw new Error('files 必须为非空制作成员清单');
  /** @type {Map<string,Identity>} */ const members = new Map();
  /** @type {import('./archive-v1.mjs').Value[]} */ const indexFiles = [];
  for (const value of files) {
    const entry = v1Object(value), name = memberName(entry.get('path'));
    if (name === manifestName) throw new Error('清单自身不能列入 files，避免自引用摘要');
    if (name === INDEX) throw new Error(`制作成员占用归档索引保留路径：${INDEX}`);
    if (members.has(name)) throw new Error(`清单重复成员：${name}`);
    if (!['production', 'technical', 'user', 'history'].includes(/** @type {string} */ (entry.get('category')))) throw new Error(`制作成员缺少明确分类：${name}`);
    const sha = entry.get('sha256');
    if (typeof sha !== 'string' || !/^[0-9a-f]{64}$/.test(sha)) throw new Error(`制作成员缺少 SHA-256 内容身份：${name}`);
    const content = await sourceIdentity(root, name);
    if (content.sha256 !== sha) throw new Error(`制作成员摘要不符：${name}`);
    members.set(name, content);
    const indexed = new Map(entry);
    indexed.set('size', v1Integer(content.size));
    indexFiles.push(indexed);
  }
  const required = await projectFileReferences(options, 'archive-required', manifest);
  const missing = [...required].filter(name => !members.has(name));
  if (missing.length) throw new Error('清单遗漏制作输入、素材或审阅记录：' + missing.sort().join(', '));
  const manifestIdentity = bytesIdentity(raw);
  const manifestEntry = new Map(/** @type {[string,import('./archive-v1.mjs').Value][]} */ ([['path', manifestName], ['sha256', manifestIdentity.sha256], ['size', v1Integer(raw.length)]]));
  const index = new Map(/** @type {[string,import('./archive-v1.mjs').Value][]} */ ([['schemaVersion', v1Integer(1)], ['manifest', manifestEntry], ['files', indexFiles]]));
  const indexBytes = dumpV1(index);
  members.set(manifestName, manifestIdentity);
  members.set(INDEX, bytesIdentity(indexBytes));
  return { root, manifestName, members, indexBytes };
}

/** 一次顺序解压，同时等待成员、tar 原始结束及 gzip 全流完成；库 finish 不是成功判据。
 * @param {string} archive @param {Map<string,Identity>} members */
async function verifyArchive(archive, members) {
  const extractor = tar.extract();
  const compressed = createReadStream(archive, { highWaterMark: CHUNK });
  /** @type {Set<string>} */ const seen = new Set();
  /** @type {string[]} */ const order = [];
  // 提前处理 rejection，避免流错误在等待成员时变成未处理异常。
  const pump = pipeline(Readable.from(strictArchiveTar(decodeArchiveGzip(compressed))), extractor).then(() => ({ error: undefined }), error => ({ error }));
  try {
    for await (const stream of extractor) {
      const header = stream.header, name = header.name;
      if (header.type !== 'file') throw new Error(`归档成员不是普通文件：${name}`);
      if (seen.has(name)) throw new Error(`归档重复成员：${name}`);
      const expected = members.get(name);
      if (!expected) throw new Error(`归档额外成员：${name}`);
      if (header.size !== expected.size) throw new Error(`归档成员内容摘要或大小不符：${name}`);
      const actual = await identity(stream);
      if (actual.size !== expected.size || actual.sha256 !== expected.sha256) throw new Error(`归档成员内容摘要或大小不符：${name}`);
      seen.add(name); order.push(name);
    }
    const result = await pump;
    if (result.error) throw result.error;
  } catch (error) {
    extractor.destroy(error instanceof Error ? error : new Error(String(error)));
    compressed.destroy();
    await pump;
    throw error;
  }
  const missing = [...members.keys()].filter(name => !seen.has(name));
  if (missing.length) throw new Error('归档缺失成员：' + missing.sort().join(', '));
  return order;
}

/** 完整核对是归档 module 的单一入口；不提升文件内任何人工审阅记录。
 * @param {import('./common.mjs').CommandOptions} options @returns {Promise<import('./common.mjs').CommandResult>} */
export async function verifyPackage(options) {
  const command = 'verify-package';
  try {
    if (!options.archive) throw new Error('verify-package 必须指定 --archive');
    const plan = await prepareArchive(options);
    const order = await verifyArchive(options.archive, plan.members);
    return { command, status: 'passed', checks: [{ id: 'archive', status: 'passed', message: '全部归档成员按顺序校验完成' }], details: { archive: options.archive, order, publication: 'verified', scope: '归档文件完整性；不判定人工确认' } };
  } catch (error) {
    return { command, status: 'failed', checks: [failure('archive', error instanceof Error ? error.message : String(error))] };
  }
}
