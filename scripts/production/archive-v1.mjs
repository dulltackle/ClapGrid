/** 旧 v1 索引的字节约定属于归档 module，领域调用方仅使用普通投影。
 * @typedef {{kind:'integer', value:bigint}|{kind:'float', value:number}} Numeric
 * @typedef {null|boolean|string|Numeric|Value[]|Map<string,Value>} Value
 */

/** 合法 JSON 的无损有序读取：重复键覆盖值而不移动首次插入位置。
 * @param {Buffer} raw @returns {Value} */
export function parseV1(raw) {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  let cursor = 0;
  const whitespace = () => { while (/[\x20\t\r\n]/.test(source[cursor] ?? '\0')) cursor++; };
  function string() {
    const start = cursor++;
    while (cursor < source.length) {
      const char = source[cursor++];
      if (char === '"') return /** @type {string} */ (JSON.parse(source.slice(start, cursor)));
      if (char === '\\') cursor++;
    }
    throw new Error('制作清单字符串未结束');
  }
  /** @returns {Value} */
  function value() {
    whitespace();
    const first = source[cursor];
    if (first === '"') return string();
    if (first === '{') {
      cursor++; whitespace();
      /** @type {Map<string, Value>} */ const result = new Map();
      if (source[cursor] === '}') { cursor++; return result; }
      while (true) {
        whitespace();
        if (source[cursor] !== '"') throw new Error('制作清单对象键必须是字符串');
        const key = string(); whitespace();
        if (source[cursor++] !== ':') throw new Error('制作清单对象缺少冒号');
        result.set(key, value()); whitespace();
        const separator = source[cursor++];
        if (separator === '}') return result;
        if (separator !== ',') throw new Error('制作清单对象缺少分隔符');
      }
    }
    if (first === '[') {
      cursor++; whitespace();
      /** @type {Value[]} */ const result = [];
      if (source[cursor] === ']') { cursor++; return result; }
      while (true) {
        result.push(value()); whitespace();
        const separator = source[cursor++];
        if (separator === ']') return result;
        if (separator !== ',') throw new Error('制作清单数组缺少分隔符');
      }
    }
    for (const [literal, result] of /** @type {[string, null|boolean][]} */ ([['null', null], ['true', true], ['false', false]])) {
      if (source.startsWith(literal, cursor)) { cursor += literal.length; return result; }
    }
    const number = source.slice(cursor).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!number) throw new Error(`制作清单 JSON 值无效（位置 ${cursor}）`);
    cursor += number[0].length;
    return /[.eE]/.test(number[0]) ? { kind: 'float', value: Number(number[0]) } : { kind: 'integer', value: BigInt(number[0]) };
  }
  const result = value(); whitespace();
  if (cursor !== source.length) throw new Error(`制作清单 JSON 后有额外内容（位置 ${cursor}）`);
  return result;
}

/** 领域投影只用于引用用途与 schema；索引始终由原有序树生成。
 * @param {Value} value @returns {any} */
export function projectV1(value) {
  if (value instanceof Map) return Object.fromEntries([...value].map(([key, item]) => [key, projectV1(item)]));
  if (Array.isArray(value)) return value.map(projectV1);
  if (value && typeof value === 'object') return Number(value.value);
  return value;
}

/** @param {Value} value @returns {Map<string,Value>} */
export function v1Object(value) {
  if (!(value instanceof Map)) throw new Error('制作清单需要对象记录');
  return value;
}

/** Python repr 的展示约定：V8 最短有效数字保留，转换阈值、指数及浮点整数标记。
 * @param {number} value */
function floatText(value) {
  if (Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return value < 0 ? '-Infinity' : 'Infinity';
  if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0';
  const negative = value < 0;
  const [mantissa = '', exponentText = '0'] = Math.abs(value).toString().split('e');
  const [whole = '', fractional = ''] = mantissa.split('.');
  const combined = whole + fractional;
  const leading = combined.match(/^0*/)?.[0].length ?? 0;
  const digits = combined.slice(leading).replace(/0+$/, '');
  const point = whole.length + Number(exponentText) - leading;
  const exponent = point - 1;
  let result;
  if (exponent < -4 || exponent >= 16) {
    result = digits[0] + (digits.length > 1 ? '.' + digits.slice(1) : '') + 'e' + (exponent < 0 ? '-' : '+') + String(Math.abs(exponent)).padStart(2, '0');
  } else if (point <= 0) result = '0.' + '0'.repeat(-point) + digits;
  else if (point >= digits.length) result = digits + '0'.repeat(point - digits.length) + '.0';
  else result = digits.slice(0, point) + '.' + digits.slice(point);
  return (negative ? '-' : '') + result;
}

/** @param {string} value */
function quote(value) {
  // 旧 ensure_ascii=False 后 UTF-8 编码拒绝孤立 surrogate；不可用替代字符改变身份。
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)) throw new Error('v1 索引包含无法 UTF-8 编码的孤立 surrogate');
  return JSON.stringify(value);
}

/** Python ensure_ascii=False, indent=2 的 v1 字节序列化。
 * @param {Value} value @returns {Buffer} */
export function dumpV1(value) {
  /** @param {Value} item @param {number} depth @returns {string} */
  function dump(item, depth) {
    const pad = '  '.repeat(depth), child = pad + '  ';
    if (item instanceof Map) {
      if (!item.size) return '{}';
      return '{\n' + [...item].map(([key, value]) => child + quote(key) + ': ' + dump(value, depth + 1)).join(',\n') + '\n' + pad + '}';
    }
    if (Array.isArray(item)) return item.length ? '[\n' + item.map(value => child + dump(value, depth + 1)).join(',\n') + '\n' + pad + ']' : '[]';
    if (typeof item === 'string') return quote(item);
    if (item && typeof item === 'object') return item.kind === 'integer' ? item.value.toString() : floatText(item.value);
    return JSON.stringify(item);
  }
  return Buffer.from(dump(value, 0) + '\n');
}

/** @param {number} value @returns {Numeric} */
export const v1Integer = value => ({ kind: 'integer', value: BigInt(value) });
