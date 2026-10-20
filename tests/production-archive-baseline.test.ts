import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { archiveBaseline as catalog, archiveBaselinePath } from './helpers/archive-baseline.js';


const root = resolve('tests/fixtures/production-archive-v1');
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('旧 Python 独立基线保留原清单、原索引和成功包内容身份', () => {
  for (const file of catalog.identities) {
    const bytes = readFileSync(resolve(root, file.path));
    assert.equal(bytes.length, file.size, file.path);
    assert.equal(hash(bytes), file.sha256, file.path);
  }
  assert.equal(catalog.success.legacyResult.status, 'passed');
  assert.equal(hash(readFileSync(archiveBaselinePath('generate.py'))), catalog.source.generatorSha256);
  assert.equal(catalog.source.commit, 'a55109aa0e93dc3b9d2e5b6f126607adb86d592d');
});

// 只查看小型固定旧夹具的普通头和局部 PAX，不调用运行归档 module 或任何写包器。
// 预期成员和字节来自冻结的旧来源 catalog/project/expected-index，而不是这个查看器。
function inspect(relative: string) {
  const tar = gunzipSync(readFileSync(archiveBaselinePath(relative)));
  const members = new Map<string, Buffer>();
  const headers: { type: string; name: string; size: number; pax: Record<string, string> }[] = [];
  let offset = 0;
  let pax: Record<string, string> = {};
  const text = (header: Buffer, start: number, length: number) => header.subarray(start, start + length).toString().replace(/\0.*$/s, '');
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const type = text(header, 156, 1);
    const headerSize = parseInt(text(header, 124, 12), 8);
    const size = type === 'x' ? headerSize : Number(pax.size ?? headerSize);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    assert.equal(body.length, size, '固定夹具正文必须完整');
    const name = type === 'x' ? text(header, 0, 100) : pax.path ?? text(header, 0, 100);
    headers.push({ type, name, size: headerSize, pax: { ...pax } });
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      pax = {};
      let cursor = 0;
      while (cursor < body.length) {
        const space = body.indexOf(32, cursor);
        const length = Number(body.subarray(cursor, space).toString());
        assert.ok(space > cursor && Number.isSafeInteger(length) && length > space - cursor + 1);
        assert.ok(cursor + length <= body.length);
        const record = body.subarray(space + 1, cursor + length - 1).toString();
        assert.equal(body[cursor + length - 1], 10);
        const equals = record.indexOf('=');
        assert.ok(equals > 0);
        pax[record.slice(0, equals)] = record.slice(equals + 1);
        cursor += length;
      }
    } else {
      assert.ok(type === '0' || type === '');
      assert.equal(members.has(name), false, '固定成功包不得有重复成员');
      members.set(name, body);
      pax = {};
    }
  }
  assert.ok(tar.length - offset >= 1024);
  assert.ok(tar.subarray(offset).every(byte => byte === 0));
  return { members, headers };
}

for (const path of ['valid.tar.gz', 'pax-overrides.tar.gz', 'valid-python-3.12.tar.gz']) {
  test(`固定旧包 ${path} 的全部成员与原始字节完全相同`, () => {
    const { members } = inspect(path);
    assert.deepEqual([...members.keys()], catalog.success.legacyResult.details!.order);
    assert.equal(members.size, 10);
    for (const member of catalog.success.members) {
      const bytes = members.get(member.path)!;
      assert.ok(bytes, member.path);
      assert.equal(bytes.length, member.size, member.path);
      assert.equal(hash(bytes), member.sha256, member.path);
      const original = member.path === '.clapgrid-package.json' ? 'expected-index.json' : 'project/' + member.path;
      assert.deepEqual(bytes, readFileSync(archiveBaselinePath(original)), member.path);
    }
    assert.equal(members.get('empty.bin')!.length, 0);
    assert.ok([...members.keys()].some(name => Buffer.byteLength(name) > 100 && name.includes('中文')));
  });
}

test('旧 v1 索引保留数值、有序扩展、覆盖位置与 UTF-8 字节序列化', () => {
  const index = readFileSync(archiveBaselinePath('expected-index.json'), 'utf8');
  const raw = readFileSync(archiveBaselinePath('project/production.json'), 'utf8');
  assert.ok(raw.includes('"overflow":1e400'));
  for (const literal of [
    '"huge": 1234567890123456789012345678901234567890', '"one": 1.0', '"negativeZero": -0.0',
    '"scientific": 1e-07', '"overflow": Infinity', '"negativeOverflow": -Infinity',
    '"smallFixed": 0.0001', '"largeFixed": 1000000000000000.0', '"largeScientific": 1e+16',
    '"text": "中文😀\\\\\\"\\n\\t\\u0001"',
  ]) assert.ok(index.includes(literal), literal);
  assert.match(index, /"path": "src\.ts",\n      "size": 24,\n      "10": "十",\n      "2": "二",\n      "01": "零一"/);
  assert.match(index, /"duplicate": "last",\n        "after": true/);
  assert.match(index, /"position": "last",\n      "trailing": null/);
  assert.equal((index.match(/"duplicate":/g) ?? []).length, 1);
  assert.equal((index.match(/"size": 999/g) ?? []).length, 0);
  assert.match(index, /"nested": \[\n          \{\n            "10": 1,\n            "2": 2,\n            "x": \[\n              1\.0,\n              -0\.0/);
  assert.ok(index.startsWith('{\n  "schemaVersion": 1,\n'));
  assert.ok(index.endsWith('\n}\n'));
  assert.equal(index.endsWith('\n\n'), false);
});

test('旧成功包的局部 PAX 实际覆盖长路径、大小和扩展元数据', () => {
  const normal = inspect('valid.tar.gz');
  assert.ok(normal.headers.some(header => header.type === 'x'));
  assert.ok(normal.headers.some(header => header.pax.path?.includes('中文长路径目录')));
  const expanded = inspect('pax-overrides.tar.gz');
  const overridden = expanded.headers.find(header => header.pax.uid === '123')!;
  assert.ok(overridden);
  assert.equal(overridden.size, 0, '物理普通头 size 是零；读取正文依赖实际 PAX size');
  assert.equal(overridden.pax.size, '13');
  assert.equal(overridden.pax.gid, '456');
  assert.equal(overridden.pax.uname, '作者');
  assert.equal(overridden.pax.gname, '组');
  assert.equal(overridden.pax.mtime, '1700000000.125');
});

test('损坏样本记录独立构造依据、旧失败原因与严格规格要求，零尾和连续流完整对照', () => {
  const names = [
    'missing', 'extra', 'duplicate', 'size', 'digest', 'manifest', 'index', 'invalid-header', 'header-truncated',
    'body-truncated', 'gzip-crc', 'gzip-length', 'gzip-truncated', 'missing-end-blocks', 'single-end-block', 'bad-header-at-end',
    'nonzero-tar-tail', 'malformed-pax', 'compressed-nonzero-tail', 'compressed-zero-tail', 'compressed-zero-then-junk',
    'compressed-zero-then-gzip', 'concatenated-empty-gzip', 'concatenated-zero-gzip', 'concatenated-nonzero-gzip',
    'concatenated-crc', 'compressed-zero-then-crc',
  ];
  assert.deepEqual(catalog.corrupt.map(sample => sample.name), names);
  const accepted = new Set(['compressed-zero-tail', 'compressed-zero-then-gzip', 'concatenated-empty-gzip', 'concatenated-zero-gzip']);
  for (const sample of catalog.corrupt) {
    assert.ok(sample.construction.length > 5, sample.name);
    assert.ok(sample.requiredReason.length > 3, sample.name);
    const expected = accepted.has(sample.name) ? 'passed' : 'failed';
    assert.equal(sample.requiredStatus, expected, sample.name);
    assert.equal(sample.legacyResult.status, expected, sample.name);
    assert.ok(sample.legacyResult.checks[0]!.message.length > 0, sample.name);
  }
});

test('Python 3.12 最低版本与本机 3.14 均实际核对固定包且索引字节相同', () => {
  assert.equal(catalog.comparison.minimumDeclared, '3.12');
  assert.equal(catalog.comparison.status, 'verified');
  assert.equal(catalog.comparison.indexBytesEqual, true);
  assert.ok(catalog.environments.some(environment => environment.version.startsWith('3.12.') && environment.status === 'verified'));
  assert.ok(catalog.environments.some(environment => environment.version.startsWith('3.14.') && environment.status === 'verified'));
  assert.equal(catalog.comparison.minimumPackResult?.status, 'passed');
  assert.equal(catalog.comparison.localVerifyMinimumResult?.status, 'passed');
  for (const sample of catalog.corrupt) {
    const compared = catalog.comparison.results!.find(result => result.path === sample.path)!;
    assert.equal(compared.result.status, sample.legacyResult.status, sample.name);
  }
});
