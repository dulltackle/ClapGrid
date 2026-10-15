import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { gunzipSync, gzipSync } from 'node:zlib';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const tar = createRequire(import.meta.url)('tar-stream');
export interface PackageMember { header: { name: string; type: string; size: number; [key: string]: any }; body: Buffer }

/** 独立测试工具只处理小包；不导入生产归档、引用或 v1 内容身份实现。 */
export async function inspectPackage(archive: string): Promise<PackageMember[]> {
  const extractor = tar.extract();
  const pump = pipeline(Readable.from([gunzipSync(readFileSync(archive))]), extractor);
  const members: PackageMember[] = [];
  try {
    for await (const stream of extractor) {
      const chunks: Buffer[] = [];
      for await (const bytes of stream) chunks.push(bytes);
      members.push({ header: stream.header, body: Buffer.concat(chunks) });
    }
    await pump;
  } catch (error) { await pump.catch(() => {}); throw error; }
  return members;
}

export async function inspect(archive: string): Promise<Record<string, string>> {
  return Object.fromEntries((await inspectPackage(archive)).map(member => [member.header.name, member.body.toString('base64')]));
}

/** 真实改包保留未变成员原 bytes；索引预期不由工具重算。 */
export async function writePackage(archive: string, members: PackageMember[]) {
  const packer = tar.pack();
  const chunks: Buffer[] = [];
  const pump = pipeline(packer, new Writable({ write(bytes, _encoding, done) { chunks.push(bytes); done(); } }));
  for (const member of members) {
    const header: PackageMember['header'] = { ...member.header, size: member.body.length };
    // tar-stream 重新生成必要的局部 PAX；旧 size/path 不能遮蔽本次变造。
    delete header.pax;
    await new Promise<void>((resolve, reject) => packer.entry(header, member.body, (error: Error | null) => error ? reject(error) : resolve()));
  }
  packer.finalize();
  await pump;
  writeFileSync(archive, gzipSync(Buffer.concat(chunks)));
}

export async function rewrite(archive: string, mode: string) {
  const members = await inspectPackage(archive);
  const changed = members.filter(member => mode !== 'missing' || member.header.name !== 'src.ts').map(member => {
    let body = member.body;
    if (mode === 'digest' && member.header.name === 'src.ts') body = Buffer.from('wrong');
    if (mode === 'manifest' && member.header.name === 'production.json') body = Buffer.concat([body, Buffer.from(' ')]);
    return { header: member.header, body };
  });
  if (mode === 'extra') changed.push({ header: { name: 'unexpected.txt', type: 'file', size: 1 }, body: Buffer.from('x') });
  if (mode === 'duplicate') changed.push(members.find(member => member.header.name === 'src.ts')!);
  await writePackage(archive, changed);
}

/** 小型有效包的物理结束位置；局部 PAX 自身按物理 size 推进，下一普通正文按有效 size 推进。 */
export function packageEnd(tarBytes: Buffer) {
  let offset = 0;
  let pax: Record<string, string> = {};
  while (offset + 512 <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      assert.ok(tarBytes.length - offset >= 1024, '有效包必须含双结束块');
      assert.ok(tarBytes.subarray(offset).every(byte => byte === 0), '有效包尾部必须全零');
      return offset;
    }
    const type = header.subarray(156, 157).toString().replace(/\0/g, '');
    assert.ok(['x', '0', ''].includes(type), '测试定位只接受普通文件与局部 PAX');
    const physical = Number.parseInt(header.subarray(124, 136).toString().replace(/\0.*$/s, '').trim(), 8);
    const size = type === 'x' ? physical : Number(pax.size ?? physical);
    assert.ok(Number.isSafeInteger(size) && size >= 0);
    const body = tarBytes.subarray(offset + 512, offset + 512 + size);
    assert.equal(body.length, size, '正文不得截断');
    offset += 512 + Math.ceil(size / 512) * 512;
    pax = {};
    if (type === 'x') {
      for (let cursor = 0; cursor < body.length;) {
        const space = body.indexOf(32, cursor);
        const length = Number(body.subarray(cursor, space).toString());
        assert.ok(space > cursor && Number.isSafeInteger(length) && length > space - cursor + 1 && cursor + length <= body.length);
        assert.equal(body[cursor + length - 1], 10);
        const record = body.subarray(space + 1, cursor + length - 1).toString();
        const equals = record.indexOf('=');
        assert.ok(equals > 0);
        pax[record.slice(0, equals)] = record.slice(equals + 1);
        cursor += length;
      }
    }
  }
  throw new Error('有效包缺少结束块');
}

export function corruptRawPackage(archive: string, mode: string) {
  const bytes = gunzipSync(readFileSync(archive));
  const end = packageEnd(bytes);
  const garbage = Buffer.alloc(512, 120);
  const changed = mode === 'invalid-header' ? Buffer.concat([garbage, bytes])
    : mode === 'nonzero-tail' ? Buffer.concat([bytes, garbage])
    : mode === 'bad-header-at-end' ? Buffer.concat([bytes.subarray(0, end), garbage, bytes.subarray(end)])
    : mode === 'missing-end-blocks' ? bytes.subarray(0, end)
    : Buffer.concat([bytes.subarray(0, end), Buffer.alloc(512)]);
  writeFileSync(archive, gzipSync(changed));
}

/** 仅向新的空目录恢复规范普通成员；不覆盖既有路径，不重写清单、索引或证据指针。 */
export async function restorePackage(archive: string, directory: string) {
  assert.equal(readdirSync(directory).length, 0, '恢复目标必须为空目录');
  const members = await inspectPackage(archive);
  const names = new Set<string>();
  for (const { header, body } of members) {
    const name = header.name;
    assert.equal(header.type, 'file', '恢复只接受普通文件');
    assert.equal(body.length, header.size, '正文大小必须准确');
    assert.ok(name && !isAbsolute(name) && !/^[a-z]:/i.test(name) && !name.includes('\\') && !name.includes('\0'));
    assert.ok(name.split('/').every(part => part && part !== '.' && part !== '..'), '成员必须是规范相对路径');
    assert.equal(names.has(name), false, '恢复拒绝重复成员');
    names.add(name);
  }
  for (const name of names) for (const other of names) assert.ok(name === other || !other.startsWith(name + '/'), '普通成员不能同时作为目录');
  for (const { header, body } of members) {
    const path = join(directory, header.name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body, { flag: 'wx' });
  }
  return members;
}
