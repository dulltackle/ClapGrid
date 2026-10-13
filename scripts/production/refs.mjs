import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** @param {string} text */
function inlineReferences(text) {
  const references = [];
  /** @type {string|undefined} */
  let fence;
  const lines = text.split('\n').map(line => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    const delimiter = marker?.[1];
    if (marker && delimiter) {
      if (!fence) fence = delimiter;
      else if (delimiter[0] === fence[0] && delimiter.length >= fence.length && /^\s*$/.test(line.slice(marker[0].length))) fence = undefined;
      return '';
    }
    return fence ? '' : line.replace(/(`+).*?\1/g, match => ' '.repeat(match.length));
  });
  const definitions = new Map();
  /** @param {string} value */
  const label = value => value.trim().replace(/\s+/g, ' ').toLowerCase();
  for (const line of lines) {
    const definition = line.match(/^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/);
    if (definition && !definitions.has(label(definition[1] ?? ''))) definitions.set(label(definition[1] ?? ''), definition[2] ?? definition[3]);
  }
  for (const [index, line] of lines.entries()) {
    if (/^\s{0,3}\[[^\]]+\]:/.test(line)) continue;
    // 标签可包含嵌套方括号；逐层寻找结尾，避免只扫描最内层而遗漏目标。
    /** @param {number} start */
    const closingBracket = start => {
      let depth = 1;
      for (let end = start + 1; end < line.length; end++) {
        if (line[end] === '\\') { end++; continue; }
        if (line[end] === '[') depth++;
        if (line[end] === ']' && --depth === 0) return end;
      }
      return -1;
    };
    for (let start = 0; start < line.length; start++) {
      if (line[start] === '\\') { start++; continue; }
      if (line[start] !== '[') continue;
      const end = closingBracket(start);
      if (end < 0) continue;
      const name = line.slice(start + 1, end);
      let cursor = end + 1;
      if (line[cursor] !== '(') {
        let key = label(name);
        const explicit = line[cursor] === '[';
        if (explicit) {
          const refEnd = closingBracket(cursor);
          if (refEnd < 0) { references.push({ reference: '', line: index + 1, error: '引用标签缺少结束符 ]。' }); start = end; continue; }
          key = label(line.slice(cursor + 1, refEnd) || name);
          cursor = refEnd + 1;
        }
        if (explicit || definitions.has(key)) references.push({ reference: definitions.get(key) ?? '', line: index + 1, error: definitions.has(key) ? undefined : `引用未定义：${key}` });
        start = cursor - 1;
        continue;
      }
      cursor++;
      while (/\s/.test(line[cursor] ?? '') && cursor < line.length) cursor++;
      let reference = '';
      let error;
      if (line[cursor] === '<') {
        const end = line.indexOf('>', cursor + 1);
        if (end < 0) error = '引用缺少结束符 >。';
        else { reference = line.slice(cursor + 1, end); cursor = end + 1; }
      } else {
        let depth = 0;
        while (cursor < line.length) {
          const char = line[cursor] ?? '';
          if (char === '\\' && cursor + 1 < line.length) { reference += line[cursor + 1]; cursor += 2; continue; }
          if (char === '(') depth++;
          if (char === ')') { if (!depth) break; depth--; }
          if (/\s/.test(char) && !depth) break;
          reference += char;
          cursor++;
        }
      }
      if (!error && !/^\s*(?:["'][^"']*["']\s*)?\)/.test(line.slice(cursor))) error = '引用格式无效；含空格的路径请使用 <路径>。';
      references.push({ reference, line: index + 1, error });
      start = cursor;
    }
  }
  return references;
}

/** @param {{project:string}} options @returns {Promise<import('./common.mjs').CommandResult>} */
export default async function refs({ project }) {
  const document = join(project, 'video.md');
  const text = await readFile(document, 'utf8');
  /** @type {import('./common.mjs').Check[]} */
  const checks = [];
  for (const [index, item] of inlineReferences(text).entries()) {
    /** @type {import('./common.mjs').Check & {resolved?:string,kind?:string}} */
    const check = { id: `reference-${index + 1}`, status: 'passed', path: document, line: item.line, reference: item.reference, message: '' };
    try {
      if (item.error) throw new Error(item.error);
      if (!item.reference) throw new Error('引用地址为空。');
      if (/^https?:/i.test(item.reference)) {
        let url;
        try { url = new URL(item.reference); } catch { throw new Error('HTTP 引用地址无效。'); }
        if (!url.hostname || /\s/.test(item.reference) || url.username || url.password) throw new Error('HTTP 引用地址无效。');
        check.kind = 'http-syntax';
        check.resolved = url.href;
        check.message = 'HTTP 地址合法；未请求远端，不证明文件存在或可访问。';
      } else {
        if (/^[a-z][a-z0-9+.-]*:/i.test(item.reference)) throw new Error('引用协议不支持；使用本地路径或 HTTP(S) 地址。');
        const path = decodeURIComponent(item.reference.split(/[?#]/)[0] ?? '');
        if (!path) throw new Error('本地引用需要文件路径。');
        check.resolved = resolve(project, path);
        let information;
        try { information = await stat(check.resolved); } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') throw new Error(`本地引用不存在：${check.resolved}`);
          throw error;
        }
        if (!information.isFile()) throw new Error(`本地引用不是文件：${check.resolved}`);
        check.kind = 'local-file';
        check.message = '本地引用已解析为文件。';
      }
    } catch (error) { check.status = 'failed'; check.message = error instanceof Error ? error.message : String(error); }
    checks.push(check);
  }
  if (!checks.length) checks.push({ id: 'references', status: 'passed', path: document, message: '文档未包含需检查的引用。' });
  return { command: 'refs', status: checks.some(check => check.status === 'failed') ? 'failed' : 'passed', checks, details: { document, scope: '本地文件存在性与 HTTP 地址合法性；不请求远端，不检查媒体内容。' } };
}
