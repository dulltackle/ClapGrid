import { readFile, realpath, stat, lstat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { resolveProjectFile } from './common.mjs';

/** @param {string} root @param {string} path */
function within(root, path) {
  const name = relative(root, path);
  return name !== '..' && !name.startsWith(`..${sep}`) && !isAbsolute(name);
}

/** 缺省与显式不合格数据不同；归档用途不把错误容器当作空记录。
 * @param {unknown} value @returns {Record<string, any>} */
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('项目文件引用需要对象记录');
  return value;
}
/** @param {unknown} value @returns {any[]} */
function list(value) {
  if (!Array.isArray(value)) throw new Error('项目文件引用需要数组记录');
  return value;
}

/** 保留旧归档本地指针的相对地址和百分号解码；两种用途共享解释，不共享选择范围。
 * @param {unknown} reference @returns {string|undefined} */
function localPointer(reference) {
  if (typeof reference !== 'string' || !reference) return;
  if (/^file:/i.test(reference)) {
    const parts = reference.match(/^file:(?:\/\/([^/?#]*))?([^?#]*)/i);
    if (parts?.[1] && parts[1] !== 'localhost') return;
    return (parts?.[2] ?? '').replace(/(?:%[0-9a-f]{2})+/gi, encoded => Buffer.from(encoded.slice(1).split('%').map(byte => Number.parseInt(byte, 16))).toString('utf8'));
  }
  if (isAbsolute(reference) || !/^[a-z][a-z0-9+.-]*:/i.test(reference)) return reference;
}

/** 当前要求或当前审阅版本能定位的原件才必须入包；不认证原件内容。
 * @param {string} root @param {unknown} reference @returns {Promise<string|undefined>} */
async function existingEvidenceFile(root, reference) {
  const pointer = localPointer(reference);
  if (pointer === undefined) return;
  const candidate = resolve(root, pointer);
  if (!within(root, candidate)) return;
  let actual;
  try { actual = await realpath(candidate); }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && ['ENOENT', 'ENOTDIR'].includes(String(error.code))) return;
    throw error;
  }
  if (!within(root, actual) || !(await stat(actual)).isFile()) return;
  if ((await lstat(candidate)).isSymbolicLink()) throw new Error(`当前证据原件不能以符号链接归档：${pointer}`);
  return relative(root, candidate).split(sep).join('/');
}

/** 可定位的项目内指针同时保护声明名称及真实目标；不认证其声明内容。
 * @param {string} reference @param {string} project @param {Set<string>} paths */
async function protectLocalPointer(reference, project, paths) {
  try {
    const pointer = localPointer(reference);
    if (pointer !== undefined) {
      const candidate = resolve(project, pointer);
      const actual = await resolveProjectFile(project, relative(project, candidate));
      paths.add(candidate);
      paths.add(actual);
    }
  } catch { /* 非文件指针交由证据命令核对；保护不判定真实性。 */ }
}

/** 报告保护保留历史、未知扩展及未通过领域格式校验的数据中的既有路径字段。
 * @param {unknown} value @param {string} project @param {Set<string>} paths @param {boolean} [evidenceOnly] */
async function protectPaths(value, project, paths, evidenceOnly = false) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    const keys = evidenceOnly ? ['path', 'artifact'] : ['path', 'card', 'source', 'audio', 'assembly', 'review', 'typecheck', 'evidence', 'lastFrame'];
    if (typeof item === 'string' && keys.includes(key)) {
      paths.add(resolve(project, item));
      if (/^file:/i.test(item)) await protectLocalPointer(item, project, paths);
    }
    else if (!evidenceOnly && ['assets', 'transitions'].includes(key) && Array.isArray(item)) {
      for (const path of item) if (typeof path === 'string') {
        paths.add(resolve(project, path));
        if (/^file:/i.test(path)) await protectLocalPointer(path, project, paths);
      }
      await protectPaths(item, project, paths, evidenceOnly);
    } else if (typeof item === 'object') await protectPaths(item, project, paths, evidenceOnly);
  }
}

/** @param {unknown} value @param {string} project @param {Set<string>} paths */
async function protectProofs(value, project, paths) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'provenance' && item && typeof item === 'object' && 'record' in item && typeof item.record === 'string') {
      await protectLocalPointer(item.record, project, paths);
    } else if (item && typeof item === 'object') await protectProofs(item, project, paths);
  }
}

/** 按用途解释项目文件引用。报告用途容忍可读的不合格记录；归档用途仅返回作者必须声明的成员名称。
 * 引用解释不保证后续磁盘状态，实际写报告及读成员仍须重新核对。
 * 可传入已解析的领域投影，让归档的无损清单读取拥有原始字节和数字表示。
 * @param {import('./common.mjs').CommandOptions} options
 * @param {'report-protection'|'archive-required'} purpose
 * @param {Record<string, any>} [input]
 * @returns {Promise<Set<string>>} */
export async function projectFileReferences(options, purpose, input) {
  if (purpose === 'report-protection') {
    const paths = new Set([resolve(options.project, options.manifest), resolve(options.project, 'video.md'), ...(options.output ? [options.output] : []), ...(options.archive ? [options.archive] : [])]);
    try {
      const manifest = input ?? JSON.parse(await readFile(resolve(options.project, options.manifest), 'utf8'));
      await protectPaths(manifest, options.project, paths);
      if (typeof manifest.evidence === 'string') {
        try {
          const source = await resolveProjectFile(options.project, manifest.evidence);
          const evidence = JSON.parse(await readFile(source, 'utf8'));
          await protectPaths(evidence, options.project, paths, true);
          await protectProofs(evidence, options.project, paths);
        } catch { /* 所属命令校验缺失或无效记录；能读取的关联路径提前保护。 */ }
      }
    } catch { /* 清单解析失败仍保护清单、文档及交付目标。 */ }
    return paths;
  }
  const root = await realpath(options.project);
  const manifest = input ?? JSON.parse(await readFile(await resolveProjectFile(root, options.manifest), 'utf8'));
  /** @type {Set<string>} */
  const paths = new Set([manifest.typecheck]);
  for (const value of list(manifest.segments)) {
    const segment = object(value);
    for (const key of ['card', 'source', 'audio', 'assembly', 'review']) paths.add(segment[key]);
    for (const path of list(segment.assets === undefined ? [] : segment.assets)) paths.add(path);
    for (const path of list(segment.transitions === undefined ? [] : segment.transitions)) paths.add(path);
    if (segment.lastFrame) paths.add(segment.lastFrame);
  }
  const sample = object(manifest.sample === undefined ? {} : manifest.sample);
  for (const role of ['video', 'plan']) {
    const reference = object(sample[role] === undefined ? {} : sample[role]);
    if (reference.path) paths.add(reference.path);
  }
  const dependencies = object(manifest.dependencies === undefined ? {} : manifest.dependencies);
  for (const value of list(dependencies.nodes === undefined ? [] : dependencies.nodes)) {
    const node = object(value);
    if (node.path) paths.add(node.path);
  }
  try { await stat(resolve(root, 'video.md')); paths.add('video.md'); }
  catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && ['ENOENT', 'ENOTDIR'].includes(String(error.code)))) throw error;
  }
  if (typeof manifest.evidence === 'string') {
    paths.add(manifest.evidence);
    const source = resolve(root, manifest.evidence);
    const actual = await realpath(source);
    if (!within(root, actual) || !(await stat(actual)).isFile()) throw new Error(`证据文件不是项目内普通文件：${manifest.evidence}`);
    const evidence = object(JSON.parse(await readFile(actual, 'utf8')));
    const references = [];
    for (const value of list(evidence.requirements === undefined ? [] : evidence.requirements)) {
      const requirement = object(value);
      for (const criterion of list(requirement.required === undefined ? [] : requirement.required)) references.push(object(criterion).artifact);
    }
    for (const value of list(evidence.records === undefined ? [] : evidence.records)) {
      const record = object(value);
      if (record.reviewVersion !== evidence.reviewVersion) continue;
      references.push(object(record.artifact === undefined ? {} : record.artifact).path, object(record.provenance === undefined ? {} : record.provenance).record);
    }
    for (const reference of references) {
      const path = await existingEvidenceFile(root, reference);
      if (path !== undefined) paths.add(path);
    }
  }
  return paths;
}
