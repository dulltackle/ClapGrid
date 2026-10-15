import { decodePythonJsonBytes } from './python-json-bytes.mjs';
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

/** JS 字符串投影以外保留 Python 码点身份；不暴露到调用方或改写原件。
 * @type {WeakMap<object, Map<string, number[]>>} */
const stringCodePoints = new WeakMap();
/** @type {WeakMap<object, Map<string, string>>} */
const dictionaryKeys = new WeakMap();

/** @param {string} text @param {number} index @param {Map<string, number>} tags @param {string} prefix */
function taggedPoint(text, index, tags, prefix) {
  if (!text.startsWith(prefix, index)) return;
  const token = text.slice(index, index + prefix.length + 6);
  const point = tags.get(token);
  return point === undefined ? undefined : { point, length: token.length };
}

/** Native 已验证语法；这里只恢复字符串码点，JSON 的转义 surrogate pair 按旧 parser 合并。
 * @param {string} source @param {Map<string, number>} tags @param {string} prefix */
function sourceStringPoints(source, tags, prefix) {
  const points = [];
  for (let index = 1; index < source.length - 1;) {
    const tagged = taggedPoint(source, index, tags, prefix);
    if (tagged) { points.push(tagged.point); index += tagged.length; continue; }
    if (source[index] === '\\') {
      if (source[index + 1] === 'u') {
        const high = Number.parseInt(source.slice(index + 2, index + 6), 16);
        const low = source.slice(index + 6, index + 8) === '\\u' ? Number.parseInt(source.slice(index + 8, index + 12), 16) : -1;
        if (high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff) { points.push(0x10000 + (high - 0xd800) * 1024 + low - 0xdc00); index += 12; }
        else { points.push(high); index += 6; }
      } else { points.push(JSON.parse('"' + source.slice(index, index + 2) + '"').codePointAt(0)); index += 2; }
    } else {
      const point = source.codePointAt(index) ?? 0;
      points.push(point); index += point > 0xffff ? 2 : 1;
    }
  }
  return points;
}

/** 已解析的 key 仍含私有原字节标记；其余码点按普通 JS Unicode 投影读取。
 * @param {string} text @param {Map<string, number>} tags @param {string} prefix */
function projectedKeyPoints(text, tags, prefix) {
  const points = [];
  for (let index = 0; index < text.length;) {
    const tagged = taggedPoint(text, index, tags, prefix);
    if (tagged) { points.push(tagged.point); index += tagged.length; }
    else { const point = text.codePointAt(index) ?? 0; points.push(point); index += point > 0xffff ? 2 : 1; }
  }
  return points;
}

/** 仅扩展旧 Python JSON 的三个数值常量；字符串、其它语法仍交由原生严格 JSON 解析。
 * 数字占位原始词形保证不出现在输入中；context.source 区分真实零与占位，不改变 NaN 的领域意义。
 * @param {string} text @param {Map<number, number>} rawSurrogates */
function parseEvidenceJson(text, rawSurrogates) {
  // 标记不能碰撞原始或 JSON 转义后的字符串/key；仅在私有解析文本中存在。
  const originals = (text.match(/"(?:[^"\\]|\\[\s\S])*"/g) ?? []).map(source => JSON.parse(source));
  let prefix = '__clapgrid_raw_surrogate_';
  while (originals.some(value => value.includes(prefix))) prefix += '_';
  const tags = new Map();
  const taggedText = [];
  let rest = 0;
  for (const [offset, point] of rawSurrogates) {
    const token = `${prefix}${point.toString(16)}__`;
    tags.set(token, point); taggedText.push(text.slice(rest, offset), token); rest = offset + 1;
  }
  taggedText.push(text.slice(rest)); text = taggedText.join('');
  /** @type {Map<string, number>} */
  const markers = new Map();
  /** @type {Map<number, string>} */
  const tokens = new Map();
  let sequence = 0;
  /** @param {number} value */
  const marker = value => {
    const existing = tokens.get(value);
    if (existing !== undefined) return existing;
    let source;
    do { source = `0e+${sequence++}`; } while (text.includes(source) || markers.has(source));
    markers.set(source, value);
    tokens.set(value, source);
    return source;
  };
  let quoted = false, escaped = false;
  const parts = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      parts.push(char);
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; parts.push(char); continue; }
    const token = ['-Infinity', 'Infinity', 'NaN'].find(token => text.startsWith(token, index));
    if (token && (index === 0 || /[ \t\r\n\[,:]/.test(text[index - 1] ?? '')) && (index + token.length === text.length || /[ \t\r\n\]},]/.test(text[index + token.length] ?? ''))) {
      parts.push(marker(token === 'NaN' ? NaN : token === 'Infinity' ? Infinity : -Infinity));
      index += token.length - 1;
    } else parts.push(char);
  }
  /** @this {object} @param {string} key @param {any} value @param {{source?:string}} [context] */
  function revive(key, value, context) {
    if (typeof value === 'number') {
      if (!context?.source) throw new Error('证据常量解析需要支持 JSON source context 的 Node');
      if (markers.has(context.source)) return markers.get(context.source);
      if (!Number.isSafeInteger(value) && /^-?(?:0|[1-9][0-9]*)$/.test(context.source)) return BigInt(context.source);
    }
    if (typeof value === 'string') {
      if (!context?.source) throw new Error('证据字符串身份需要 JSON source context');
      const points = sourceStringPoints(context.source, tags, prefix);
      const fields = stringCodePoints.get(this) ?? new Map();
      fields.set(key, points); stringCodePoints.set(this, fields);
      return points.map(point => String.fromCodePoint(point)).join('');
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const keys = new Map();
      for (const name of Object.keys(value)) keys.set(JSON.stringify(projectedKeyPoints(name, tags, prefix)), name);
      dictionaryKeys.set(value, keys);
    }
    return value;
  }
  // 在 Native 折叠重复键以前统一 Python 相同的键身份，否则首插入顺序会误选最后覆盖值。
  // 独立 surrogate 使用私有标记，仍与合法 pair 形成的非 BMP 标量保持不同身份。
  const normalized = parts.join('').replace(/"(?:[^"\\]|\\[\s\S])*"/g, (source, offset, full) => {
    if (!/^\s*:/.test(full.slice(offset + source.length))) return source;
    const points = sourceStringPoints(source, tags, prefix);
    const name = points.map(point => {
      if (point < 0xd800 || point > 0xdfff) return String.fromCodePoint(point);
      const token = `${prefix}${point.toString(16)}__`;
      tags.set(token, point);
      return token;
    }).join('');
    return JSON.stringify(name);
  });
  return JSON.parse(normalized, revive);
}

/** 原 json.loads 审阅版本的值比较：数字与 bool、缺省与 null、容器结构保持旧含义。
 * NaN 标量不相等；容器中的 NaN 词元来自旧解析器共享常量，按同一对象比较。
 * @param {unknown} left @param {unknown} right @param {boolean} [nested] @param {number[]} [leftPoints] @param {number[]} [rightPoints] @returns {boolean} */
function sameReviewVersion(left, right, nested = false, leftPoints, rightPoints) {
  left = left ?? null;
  right = right ?? null;
  /** @param {unknown} value */
  const numeric = value => typeof value === 'boolean' ? Number(value) : typeof value === 'number' || typeof value === 'bigint' ? value : undefined;
  const a = numeric(left), b = numeric(right);
  if (a !== undefined && b !== undefined) {
    if (typeof a === 'number' && Number.isNaN(a)) return nested && typeof b === 'number' && Number.isNaN(b);
    if (typeof b === 'number' && Number.isNaN(b)) return false;
    if (typeof a === typeof b) return a === b;
    const integer = typeof a === 'bigint' ? a : b;
    const floating = typeof a === 'number' ? a : b;
    return typeof integer === 'bigint' && typeof floating === 'number' && Number.isFinite(floating) && Number.isInteger(floating) && BigInt(floating) === integer;
  }
  if (typeof left === 'string' && typeof right === 'string') {
    const x = leftPoints ?? [...left].map(char => char.codePointAt(0));
    const y = rightPoints ?? [...right].map(char => char.codePointAt(0));
    return x.length === y.length && x.every((point, index) => point === y[index]);
  }
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => sameReviewVersion(value, right[index], true, stringCodePoints.get(left)?.get(String(index)), stringCodePoints.get(right)?.get(String(index))));
  if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
    const x = /** @type {Record<string, unknown>} */ (left);
    const y = /** @type {Record<string, unknown>} */ (right);
    const keys = dictionaryKeys.get(x) ?? new Map(Object.keys(x).map(key => [JSON.stringify([...key].map(char => char.codePointAt(0))), key]));
    const other = dictionaryKeys.get(y) ?? new Map(Object.keys(y).map(key => [JSON.stringify([...key].map(char => char.codePointAt(0))), key]));
    return keys.size === other.size && [...keys].every(([identity, key]) => {
      const target = other.get(identity);
      return target !== undefined && sameReviewVersion(x[key], y[target], true, stringCodePoints.get(x)?.get(key), stringCodePoints.get(y)?.get(target));
    });
  }
  return false;
}

/** 读取旧归档能消费的证据原字节，仅生成领域投影，不改写原件。
 * @param {Buffer} raw @param {string} path */
function parseEvidenceBytes(raw, path) {
  try {
    const decoded = decodePythonJsonBytes(raw);
    return parseEvidenceJson(decoded.text, decoded.surrogates);
  } catch (error) {
    throw new Error(`证据文件编码或 JSON 无效：${path}：${String(error)}`);
  }
}

/** 报告同时保护旧 Native UTF-8 replacement 与严格兼容投影；归档只采用严格解释。
 * @param {string} path @param {'report-protection'|'archive-required'} purpose */
async function readEvidenceJson(path, purpose) {
  const raw = await readFile(path);
  if (purpose === 'archive-required') return [parseEvidenceBytes(raw, path)];
  const projections = [];
  try { projections.push(JSON.parse(raw.toString('utf8'))); } catch {}
  try { projections.push(parseEvidenceBytes(raw, path)); } catch (error) {
    if (!projections.length) throw error;
  }
  return projections;
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
          for (const evidence of await readEvidenceJson(source, 'report-protection')) {
            await protectPaths(evidence, options.project, paths, true);
            await protectProofs(evidence, options.project, paths);
          }
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
    const [projection] = await readEvidenceJson(actual, 'archive-required');
    const evidence = object(projection);
    const references = [];
    for (const value of list(evidence.requirements === undefined ? [] : evidence.requirements)) {
      const requirement = object(value);
      for (const criterion of list(requirement.required === undefined ? [] : requirement.required)) references.push(object(criterion).artifact);
    }
    for (const value of list(evidence.records === undefined ? [] : evidence.records)) {
      const record = object(value);
      if (!sameReviewVersion(record.reviewVersion, evidence.reviewVersion, false, stringCodePoints.get(record)?.get('reviewVersion'), stringCodePoints.get(evidence)?.get('reviewVersion'))) continue;
      references.push(object(record.artifact === undefined ? {} : record.artifact).path, object(record.provenance === undefined ? {} : record.provenance).record);
    }
    for (const reference of references) {
      const path = await existingEvidenceFile(root, reference);
      if (path !== undefined) paths.add(path);
    }
  }
  return paths;
}
