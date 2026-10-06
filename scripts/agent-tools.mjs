import { spawnSync } from 'node:child_process';
import { realpathSync, statSync, readFileSync, writeFileSync } from 'node:fs';
const [command, ...args] = process.argv.slice(2);
// 脱敏在写盘和显示之前进行；调用方仍应从源头排除含未知密钥的输入。
const secretKey = /token|secret|password|credential|authorization|cookie|api[-_]?key/i;
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? '[REDACTED]' : sanitize(item)]));
  if (typeof value !== 'string') return value;
  // HTTP 敏感头的分号、逗号仍属于同一值，先整行隐藏并保留换行。
  let text = value.replace(/((?<![\w-])["']?(?:set-cookie|cookie|proxy-authorization|authorization)["']?[ \t]*:[ \t]*)[^\r\n]*/gi, '$1[REDACTED]');
  text = text.replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+)|Bearer\s+[^\s"']+/gi, '[REDACTED]');
  for (const [key, secret] of Object.entries(process.env)) if (secretKey.test(key) && secret) text = text.split(secret).join('[REDACTED]');
  return text.replace(/((?<![\w.-])["']?[\w.-]*(?:token|secret|password|credentials?|api[-_]?key|authorization|cookie)[\w.-]*["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,;]+)/gi, '$1[REDACTED]');
}
function save(path, value) {
  const safe = sanitize(value);
  writeFileSync(path, JSON.stringify(safe, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return safe;
}
const print = (value) => console.log(JSON.stringify(value));
try {
  if (command === 'interpreter') {
    const attempts = [];
    for (const candidate of args) {
      const result = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000 });
      attempts.push({ candidate, available: result.status === 0 });
      if (result.status === 0) { print({ selected: candidate, attempts }); process.exit(0); }
    }
    print({ selected: null, attempts }); process.exitCode = 1;
  } else if (command === 'skill') {
    const path = realpathSync(args[0]);
    if (!statSync(path).isFile()) throw new Error('需要技能文件路径');
    print({ path });
  } else if (command === 'github') {
    const [endpoint, projection, destination] = args;
    if (/[?&]page=/.test(endpoint)) throw new Error('分页起点由入口管理');
    if (!/^repos\/[\w.-]+\/[\w.-]+\//.test(endpoint)) throw new Error('需要仓库 REST 路径');
    const fields = projection.split(',');
    if (!fields.length || fields.some((field) => !/^[A-Za-z_]\w*$/.test(field))) throw new Error('需要顶层字段');
    const result = spawnSync('gh', ['api', endpoint, '--method', 'GET', '--paginate', '--slurp'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
    if (result.status !== 0) throw new Error('GitHub 查询失败');
    const pages = JSON.parse(result.stdout);
    if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) throw new Error('仅支持 REST 列表端点');
    const items = pages.flat().map((item) => Object.fromEntries(fields.map((field) => {
      if (!Object.hasOwn(item, field)) throw new Error('请求字段缺失');
      return [field, item[field]];
    })));
    const saved = save(destination, { source: endpoint, fields, pages: pages.length, count: items.length, complete: true, redacted: true, items });
    const preview = JSON.stringify(saved.items.slice(0, 10));
    if (preview.length <= 4000) print({ ...saved, items: saved.items.slice(0, 10), truncated: items.length > 10, evidence: destination });
    else print({ source: saved.source, fields, pages: saved.pages, count: saved.count, complete: true, redacted: true, truncated: true, evidence: destination });
  } else if (command === 'capture') {
    const input = readFileSync(0, 'utf8');
    let value;
    try { value = JSON.parse(input); } catch { value = input; }
    const completeness = args[1] ?? 'unknown';
    if (!['complete', 'truncated', 'unknown'].includes(completeness)) throw new Error('需要来源完整性');
    save(args[0], { completeness, redacted: true, value });
    print({ evidence: args[0], completeness, redacted: true, truncated: true, inputBytes: Buffer.byteLength(input) });
  } else if (command === 'read') {
    const [path, start = '1', count = '40', position = '0', budget = '8192'] = args;
    const from = Number(start), limit = Number(count), offset = Number(position), byteBudget = Number(budget);
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(byteBudget) || byteBudget < 1024 || byteBudget > 16384) throw new Error('偏移或预算无效');
    if (!Number.isInteger(from) || from < 1 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('行范围无效');
    const raw = readFileSync(path, 'utf8');
    let value;
    try { value = JSON.stringify(sanitize(JSON.parse(raw)), null, 2); } catch { value = sanitize(raw); }
    const lines = value.split('\n');
    if (from > lines.length || offset > lines[from - 1].length) throw new Error('起点超出内容');
    // 偏移以规范化脱敏文本的 UTF-16 代码单元计；只在完整码点边界续读。
    if (offset > 0 && /[\uD800-\uDBFF]/.test(lines[from - 1][offset - 1]) && /[\uDC00-\uDFFF]/.test(lines[from - 1][offset] ?? '')) throw new Error('偏移切开码点');
    const endLine = Math.min(from - 1 + limit, lines.length);
    const selected = lines.slice(from - 1, endLine).join('\n').slice(offset) + (endLine < lines.length ? '\n' : '');
    const points = Array.from(selected.slice(0, byteBudget));
    // slice 的上界可能落在代理对之间，移除末尾孤立高代理，留待下一次读取。
    if (points.length && /^[\uD800-\uDBFF]$/.test(points.at(-1))) points.pop();
    const response = (size) => {
      const text = points.slice(0, size).join('');
      const parts = text.split('\n');
      const line = from + parts.length - 1;
      const position = parts.length === 1 ? offset + text.length : parts.at(-1).length;
      const next = line === lines.length && position === lines.at(-1).length ? null : { line, offset: position };
      return { start: from, offset, totalLines: lines.length, byteBudget, text, next, truncated: from > 1 || offset > 0 || next !== null };
    };
    let low = 0, high = points.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (Buffer.byteLength(JSON.stringify(response(middle))) + 1 <= byteBudget) low = middle;
      else high = middle - 1;
    }
    if (selected.length && low === 0) throw new Error('预算不足');
    print(response(low));
  } else throw new Error('未知命令');
} catch { console.error('操作失败，请核对命令、路径与输入格式；未输出原始错误内容。'); process.exitCode = 1; }
