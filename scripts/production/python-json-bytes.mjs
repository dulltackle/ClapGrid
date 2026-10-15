/** 旧 json.loads 的 surrogatepass 保留编码代理字符；其它 UTF-8 错误仍严格拒绝。
 * @param {Buffer} raw */
function decodeUtf8(raw) {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  /** @type {Map<number, number>} */
  const surrogates = new Map();
  try { return { text: decoder.decode(raw), surrogates }; }
  catch {
    const parts = [];
    let start = 0, length = 0;
    for (let index = 0; index + 2 < raw.length; index++) {
      const second = raw[index + 1] ?? 0, third = raw[index + 2] ?? 0;
      if (raw[index] === 0xed && second >= 0xa0 && second <= 0xbf && third >= 0x80 && third <= 0xbf) {
        const preceding = decoder.decode(raw.subarray(start, index));
        const point = 0xd000 | (second & 0x3f) << 6 | third & 0x3f;
        parts.push(preceding); length += preceding.length; surrogates.set(length, point);
        parts.push(String.fromCharCode(point)); length++; index += 2; start = index + 1;
      }
    }
    parts.push(decoder.decode(raw.subarray(start)));
    return { text: parts.join(''), surrogates };
  }
}

/** Python json.loads(bytes) 的字节解释；码点身份由各自语义解析器保存。
 * @param {Buffer} raw */
export function decodePythonJsonBytes(raw) {
  // 与旧 Python json.detect_encoding 一致：UTF-32 BOM 必须先于 UTF-16；无 BOM 根据零字节位置判别。
  let width = 1, little = true, offset = 0;
  if (raw.subarray(0, 4).equals(Buffer.from([0, 0, 0xfe, 0xff]))) { width = 4; little = false; offset = 4; }
  else if (raw.subarray(0, 4).equals(Buffer.from([0xff, 0xfe, 0, 0]))) { width = 4; offset = 4; }
  else if (raw.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) { width = 2; little = false; offset = 2; }
  else if (raw.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) { width = 2; offset = 2; }
  else if (raw.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) offset = 3;
  else if (raw.length >= 4) {
    if (!raw[0]) { width = raw[1] ? 2 : 4; little = false; }
    else if (!raw[1]) width = raw[2] || raw[3] ? 2 : 4;
  } else if (raw.length === 2) {
    if (!raw[0]) { width = 2; little = false; }
    else if (!raw[1]) width = 2;
  }
  const body = raw.subarray(offset);
  let decoded;
  if (width === 1) decoded = decodeUtf8(body);
  else {
    if (body.length % width) throw new Error(`UTF-${width * 8} 代码单元被截断`);
    const units = [];
    /** @type {Map<number, number>} */
    const surrogates = new Map();
    let length = 0;
    for (let index = 0; index < body.length; index += width) {
      let point = width === 2 ? (little ? body.readUInt16LE(index) : body.readUInt16BE(index)) : (little ? body.readUInt32LE(index) : body.readUInt32BE(index));
      if (width === 2 && point >= 0xd800 && point <= 0xdbff && index + 2 < body.length) {
        const low = little ? body.readUInt16LE(index + 2) : body.readUInt16BE(index + 2);
        if (low >= 0xdc00 && low <= 0xdfff) { point = 0x10000 + (point - 0xd800) * 1024 + low - 0xdc00; index += 2; }
      }
      if (point >= 0xd800 && point <= 0xdfff) surrogates.set(length, point);
      const unit = String.fromCodePoint(point); units.push(unit); length += unit.length;
    }
    decoded = { text: units.join(''), surrogates };
  }
  return decoded;
}
