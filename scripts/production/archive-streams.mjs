import { createGunzip } from 'node:zlib';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
// 版本由 package-lock 固定；格式字段编解码交给成熟库，guard 仅补完整性与原始 framing。
const headers = require(join(dirname(require.resolve('tar-stream')), 'headers.js'));
const MAX_PAX = 4 * 1024 * 1024;

/** @param {unknown} error */
const asError = error => error instanceof Error ? error : new Error(String(error));

/** 完整消费 gzip：Gunzip 在压缩零填充处停止，bytesWritten 精确标记未消费部分。
 * 零尾后重新开启解码器，以继续校验合法后续流或传播隐藏的 CRC/截断错误。
 * 输入与解压输出均遵守背压，不积存整包或整成员。
 * @param {AsyncIterable<Buffer>} source @returns {AsyncGenerator<Buffer>} */
export async function* decodeArchiveGzip(source) {
  const input = source[Symbol.asyncIterator]();
  /** @type {Buffer} */ let pending = Buffer.alloc(0);
  let decodedAny = false;
  /** @type {import('node:zlib').Gunzip|undefined} */ let current;
  try {
    while (true) {
      if (!pending.length) {
        const next = await input.next();
        if (next.done) {
          if (!decodedAny) throw new Error('gzip 归档为空或被截断');
          return;
        }
        pending = next.value;
      }
      if (decodedAny) {
        let first = 0;
        while (first < pending.length && pending[first] === 0) first++;
        pending = pending.subarray(first);
        if (!pending.length) continue;
      }
      const gzip = current = createGunzip();
      // 消费者还未迭代时也观察错误；实际错误同时进入 feed 结果和异步读取。
      gzip.on('error', () => {});
      const initial = pending;
      pending = Buffer.alloc(0);
      const feed = (async () => {
        let chunk = initial;
        while (true) {
          const before = gzip.bytesWritten;
          await new Promise((resolve, reject) => {
            // zlib 的 CRC 错误可能只发 error/close 而不调用本次 write callback。
            // 三条终止路径共同结算，避免失败报告被悬挂的 Promise 阻塞。
            /** @param {Error|null|undefined} [error] */
            const done = error => {
              gzip.off('error', done); gzip.off('close', closed);
              if (error) reject(error); else resolve(undefined);
            };
            const closed = () => done(new Error('gzip 解码器在写入完成前关闭'));
            gzip.once('error', done); gzip.once('close', closed);
            gzip.write(chunk, done);
          });
          const consumed = gzip.bytesWritten - before;
          if (consumed < 0 || consumed > chunk.length) throw new Error('gzip 消费位置无效');
          if (consumed < chunk.length) {
            gzip.end();
            return { tail: chunk.subarray(consumed) };
          }
          const next = await input.next();
          if (next.done) { gzip.end(); return { tail: Buffer.alloc(0) }; }
          chunk = next.value;
        }
      })().catch(error => { gzip.destroy(asError(error)); return { error: asError(error), tail: Buffer.alloc(0) }; });
      let exhausted = false;
      try {
        for await (const chunk of gzip) yield /** @type {Buffer} */ (chunk);
        exhausted = true;
      } finally {
        gzip.destroy();
        const result = await feed;
        // 外层 tar 拒绝时会取消本 generator；不以该取消导致的 gzip 关闭错误覆盖原原因。
        if ('error' in result && exhausted) throw result.error;
        pending = result.tail;
      }
      decodedAny = true;
      current = undefined;
    }
  } finally {
    current?.destroy();
    // 输入读取错误已在 next() 传播；取消清理的 AbortError 不能覆盖 tar/成员的具体失败。
    await input.return?.().catch(() => {});
  }
}

/** 有界原始字节读取器，文件正文始终只保留当前输入 chunk。 */
class Blocks {
  /** @param {AsyncIterable<Buffer>} source */
  constructor(source) {
    this.input = source[Symbol.asyncIterator]();
    /** @type {Buffer} */ this.chunk = Buffer.alloc(0);
    this.offset = 0;
  }
  /** @returns {Promise<boolean>} */
  async load() {
    if (this.offset < this.chunk.length) return true;
    const next = await this.input.next();
    if (next.done) return false;
    this.chunk = next.value;
    this.offset = 0;
    return this.chunk.length ? true : this.load();
  }
  /** @param {number} length @param {string} context @returns {AsyncGenerator<Buffer>} */
  async *take(length, context) {
    while (length > 0) {
      if (!(await this.load())) throw new Error(`归档${context}截断或结束块缺失`);
      const end = Math.min(this.chunk.length, this.offset + length);
      const bytes = this.chunk.subarray(this.offset, end);
      length -= bytes.length;
      this.offset = end;
      yield bytes;
    }
  }
  /** @param {number} length @param {string} context @returns {Promise<Buffer>} */
  async read(length, context) {
    const parts = [];
    for await (const bytes of this.take(length, context)) parts.push(bytes);
    return parts.length === 1 ? /** @type {Buffer} */ (parts[0]) : Buffer.concat(parts, length);
  }
  async *tail() {
    while (await this.load()) {
      const bytes = this.chunk.subarray(this.offset);
      this.offset = this.chunk.length;
      yield bytes;
    }
  }
  async close() { await this.input.return?.(); }
}

/** 通用库的 parseInt 容错不能把损坏数值头接受为有效头。
 * @param {Buffer} header @param {number} start @param {number} size */
function strictOctal(header, start, size) {
  const field = header.subarray(start, start + size);
  if ((field[0] ?? 0) & 128) {
    if (field[0] !== 128 && field[0] !== 255) throw new Error('归档文件头含无效二进制数值');
    return; // 库解码 base-256；实际 size 另检查安全整数及非负。
  }
  if (!/^[\x00 ]*[0-7]*[\x00 ]*$/.test(field.toString('latin1'))) throw new Error('归档文件头含无效八进制数值');
}

/** @param {Buffer} bytes @param {boolean} isGlobal @returns {Map<string,string>} */
function strictPax(bytes, isGlobal) {
  /** @type {Map<string,string>} */ const result = new Map();
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  let cursor = 0;
  while (cursor < bytes.length) {
    const space = bytes.indexOf(32, cursor);
    if (space < 0) throw new Error('PAX 记录缺少字节长度');
    const prefix = bytes.subarray(cursor, space).toString('latin1');
    if (!/^[1-9][0-9]*$/.test(prefix)) throw new Error('PAX 记录字节长度无效');
    const length = Number(prefix), end = cursor + length;
    if (!Number.isSafeInteger(length) || end > bytes.length || length <= space - cursor + 2 || bytes[end - 1] !== 10) throw new Error('PAX 记录字节长度、正文或终止换行损坏');
    const record = utf8.decode(bytes.subarray(space + 1, end - 1));
    const equals = record.indexOf('=');
    if (equals < 1 || record.includes('\0')) throw new Error('PAX 记录键值损坏');
    const key = record.slice(0, equals), value = record.slice(equals + 1);
    if (key.includes('\n') || key.includes(' ')) throw new Error('PAX 记录键名损坏');
    if (/^(?:GNU\.sparse|SCHILY\.(?:realsize|sparse|filetype))/.test(key)) throw new Error('归档包含不支持的 PAX 稀疏格式');
    if (['size', 'uid', 'gid'].includes(key) && value && (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value)))) throw new Error(`PAX ${key} 不是有效安全整数`);
    // 旧 Python 对实际文件纳秒时间使用 float 文本，可能写出 1e-07 等科学记数法。
    // 有限数值和完整词法仍须核对，不能用 parseFloat 接受前缀或 NaN/Infinity。
    if (['mtime', 'atime', 'ctime'].includes(key) && value && (!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(value) || !Number.isFinite(Number(value)))) throw new Error(`PAX ${key} 时间无效`);
    if (['path', 'linkpath'].includes(key) && !value && !isGlobal) throw new Error(`PAX ${key} 不能为空`);
    result.set(key, value);
    cursor = end;
  }
  return result;
}

/** @param {Map<string,string>} fields */
function normalizedPax(fields) {
  const bytes = headers.encodePax({ pax: Object.fromEntries(fields) });
  const header = headers.encode({ name: 'PaxHeader', type: 'pax-header', size: bytes.length, mode: 0o644, uid: 0, gid: 0, mtime: new Date(0) });
  return [header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)];
}

/** 检查原始 tar framing，并给库提供规范的有效局部 PAX 与标准双零结束。
 * 原始全局 PAX 与局部 PAX 只在这里归一化，tar 字段编解码及成员读取仍由 tar-stream 完成。
 * 成功前读取全部 gzip 明文，结束后任意长度的全零填充沿用旧接受行为。
 * @param {AsyncIterable<Buffer>} source @returns {AsyncGenerator<Buffer>} */
export async function* strictArchiveTar(source) {
  const blocks = new Blocks(source);
  /** @type {Map<string,string>} */ const global = new Map();
  /** @type {Map<string,string>} */ let local = new Map();
  let pendingPax = false;
  try {
    while (true) {
      const raw = await blocks.read(512, '文件头');
      if (raw.every(byte => byte === 0)) {
        if (pendingPax) throw new Error('PAX 扩展后缺少实际归档成员');
        const second = await blocks.read(512, '第二个结束零块');
        if (!second.every(byte => byte === 0)) throw new Error('归档缺少第二个结束零块或结束后存在非零数据');
        yield raw; yield second;
        for await (const tail of blocks.tail()) if (tail.some(byte => byte !== 0)) throw new Error('归档结束块后存在非零数据或额外成员');
        return;
      }
      for (const [offset, size] of /** @type {[number,number][]} */ ([[100, 8], [108, 8], [116, 8], [124, 12], [136, 12], [148, 8], [329, 8], [337, 8]])) strictOctal(raw, offset, size);
      // 库会把坏 UTF-8 替换成 U+FFFD；不能让不同原字节别名成有效成员。
      const utf8 = new TextDecoder('utf-8', { fatal: true });
      for (const [offset, length] of /** @type {[number,number][]} */ ([[0, 100], [157, 100], [265, 32], [297, 32], [345, 155]])) {
        const field = raw.subarray(offset, offset + length), end = field.indexOf(0);
        utf8.decode(end === -1 ? field : field.subarray(0, end));
      }
      const header = headers.decode(raw, 'utf-8', false);
      if (!header) throw new Error('归档文件头非全零却被解析为结束块');
      if (raw.subarray(257, 263).toString('latin1') !== 'ustar\0' || raw.subarray(263, 265).toString('latin1') !== '00') throw new Error('归档包含不支持的 tar 格式');
      if (!['file', 'pax-header', 'pax-global-header'].includes(header.type)) throw new Error(`归档成员不是普通文件或包含不支持类型：${header.name} (${header.type})`);
      if (!Number.isSafeInteger(header.size) || header.size < 0) throw new Error('归档文件头大小无效');
      if (header.type !== 'file') {
        if (header.size > MAX_PAX) throw new Error('PAX 扩展超过支持的元数据大小');
        const fields = strictPax(await blocks.read(header.size, 'PAX 正文'), header.type === 'pax-global-header');
        for await (const _ of blocks.take((512 - header.size % 512) % 512, 'PAX 填充')) { /* 只推进原始物理填充。 */ }
        if (header.type === 'pax-global-header') {
          for (const [key, value] of fields) { if (value === '') global.delete(key); else global.set(key, value); }
        } else { for (const [key, value] of fields) local.set(key, value); }
        pendingPax = true;
        continue;
      }
      const effective = new Map([...global, ...local]);
      for (const [key, value] of effective) if (value === '') effective.delete(key);
      const size = effective.has('size') ? Number(effective.get('size')) : header.size;
      if (!Number.isSafeInteger(size) || size < 0) throw new Error('PAX 有效成员大小无效');
      if (effective.size) for (const chunk of normalizedPax(effective)) if (chunk.length) yield chunk;
      yield raw;
      yield* blocks.take(size, '成员正文');
      yield* blocks.take((512 - size % 512) % 512, '成员填充');
      local = new Map(); pendingPax = false;
    }
  } finally { await blocks.close().catch(() => {}); }
}
