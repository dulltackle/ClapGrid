import { test, type ResourceFixtures } from './helpers/resource-test.js';
import { vi } from 'vitest';
import assert from 'node:assert/strict';
import { cpSync, rmSync, readFileSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { archiveBaseline, archiveBaselinePath } from './helpers/archive-baseline.js';
import { gzipSync, gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

type Resources = Pick<ResourceFixtures, 'command' | 'createDirectory'>;

const cli = resolve('scripts/production.mjs');
function fixture(t: Pick<Resources, 'createDirectory'>) {
  const project = t.createDirectory(join(tmpdir(), 'clapgrid-node-v1-'));
  cpSync(archiveBaselinePath('project'), project, { recursive: true });
  return project;
}
async function verify(t: Pick<Resources, 'command'>, project: string, archive: string, env = process.env) {
  const report = join(project, 'archive-report.json');
  rmSync(report, { force: true });
  const result = (await t.command(process.execPath, [cli, 'verify-package', '--project', project, '--archive', archive, '--report', report], { encoding: 'utf8', env }));
  assert.equal(result.error, undefined);
  assert.ok(existsSync(report), result.stdout + result.stderr);
  return { ...result, report: JSON.parse(readFileSync(report, 'utf8')) };
}

test('verify-package 全程使用 Node 核对固定旧 v1 包，PATH 中没有 Python 仍保留成员顺序与审阅含义', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const project = fixture(t);
  const result = (await verify(t, project, archiveBaselinePath('valid.tar.gz'), { ...process.env, PATH: project }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.report.status, 'passed');
  assert.deepEqual(result.report.details.order, archiveBaseline.success.legacyResult.details!.order);
  assert.match(result.report.details.scope, /不判定人工确认/);
  assert.equal(readFileSync(join(project, 'card.json'), 'utf8'), '{"status":"pending"}\n');
});

for (const path of ['valid.tar.gz', 'pax-overrides.tar.gz', 'valid-python-3.12.tar.gz']) {
  test(`真实 Node 入口接受独立旧成功包 ${path}`, async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
    const project = fixture(t);
    const before = readFileSync(join(project, 'production.json'));
    const result = (await verify(t, project, archiveBaselinePath(path), { ...process.env, PATH: project }));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(result.report.details.order, archiveBaseline.success.legacyResult.details!.order);
    assert.deepEqual(readFileSync(join(project, 'production.json')), before);
  });
}

for (const name of ['positive-nanoseconds', 'negative-nanoseconds']) {
  test(`真实 Node 入口接受旧统一入口实际写出的 PAX 科学记数时间 ${name}`, async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
    const project = fixture(t);
    const root = resolve('tests/fixtures/production-archive-pax-time');
    const provenance = JSON.parse(readFileSync(join(root, 'catalog.json'), 'utf8'));
    assert.equal(provenance.source.archiveSha256, archiveBaseline.source.sha256);
    const entry = provenance.fixtures.find((entry: { path: string }) => entry.path === name + '.tar.gz');
    const archive = join(root, entry.path), bytes = readFileSync(archive);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.equal(bytes.length, entry.size);
    assert.equal(entry.legacyResults[0].returncode, 0);
    assert.equal(entry.legacyResults[1].returncode, 0);
    for (const expected of archiveBaseline.success.members) {
      const actual = entry.members.find((member: { path: string }) => member.path === expected.path);
      assert.equal(actual.size, expected.size, expected.path);
      assert.equal(actual.sha256, expected.sha256, expected.path);
    }
    assert.equal(entry.members.find((member: { path: string }) => member.path === 'src.ts').pax.mtime, name === 'positive-nanoseconds' ? '1.0000000000000001e-07' : '-9.999999994736442e-08');
    const result = (await verify(t, project, archive, { ...process.env, PATH: project }));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(result.report.details.order, archiveBaseline.success.legacyResult.details!.order);
  });
}

for (const sample of archiveBaseline.corrupt) {
  test(`真实 Node 入口按旧完整流语义核对独立样本 ${sample.name}`, async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
    const project = fixture(t);
    const before = readFileSync(join(project, 'production.json'));
    const result = (await verify(t, project, archiveBaselinePath(sample.path), { ...process.env, PATH: project }));
    assert.equal(result.status, sample.requiredStatus === 'passed' ? 0 : 1, result.stdout + result.stderr);
    assert.equal(result.report.status, sample.requiredStatus, JSON.stringify(result.report));
    assert.deepEqual(readFileSync(join(project, 'production.json')), before);
    if (sample.requiredStatus === 'failed') assert.ok(result.report.checks.some((check: { status: string }) => check.status === 'failed'));
  });
}

test('复杂 v1 数字直接字节约定覆盖科学阈值、最小非零值、负零与整数精度', async ({  }) => {
  const { dumpV1, parseV1 } = await import(pathToFileURL(resolve('scripts/production/archive-v1.mjs')).href);
  const raw = Buffer.from('[1.0,-0.0,-0,1e-4,1e-5,1e15,1e16,5e-324,1.7976931348623157e308,1e400,-1e400,1234567890123456789012345678901234567890]');
  // 独立 Python 3.12/3.14 对照的已知字面结果，不调用待测序列化器生成 expected。
  assert.equal(dumpV1(parseV1(raw)).toString(), '[\n  1.0,\n  -0.0,\n  0,\n  0.0001,\n  1e-05,\n  1000000000000000.0,\n  1e+16,\n  5e-324,\n  1.7976931348623157e+308,\n  Infinity,\n  -Infinity,\n  1234567890123456789012345678901234567890\n]\n');
  assert.throws(() => dumpV1(parseV1(Buffer.from('"\\ud800"'))), /surrogate/);
  for (const malformed of ['[01]', '[1.]', '{"x":1,}', '[1,]', 'true junk', '{"x":"\\q"}']) assert.throws(() => parseV1(Buffer.from(malformed)));
});

for (const mode of ['escape', 'absolute', 'backslash', 'noncanonical', 'duplicate', 'self', 'reserved', 'category', 'digest-shape', 'omitted-required', 'symlink', 'changed-source']) {
  test(`真实 Node 入口保持成员声明 ${mode} 的拒绝规则`, async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
    const project = fixture(t);
    const path = join(project, 'production.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    let expected: RegExp;
    switch (mode) {
      case 'escape': manifest.files[0].path = '../src.ts'; expected = /规范项目相对路径/; break;
      case 'absolute': manifest.files[0].path = join(project, 'src.ts'); expected = /规范项目相对路径/; break;
      case 'backslash': manifest.files[0].path = 'folder\\src.ts'; expected = /规范项目相对路径/; break;
      case 'noncanonical': manifest.files[0].path = './src.ts'; expected = /规范项目相对路径/; break;
      case 'duplicate': manifest.files.push({ ...manifest.files[0] }); expected = /重复成员/; break;
      case 'self': manifest.files[0].path = 'production.json'; expected = /清单自身/; break;
      case 'reserved': manifest.files[0].path = '.clapgrid-package.json'; expected = /索引保留路径/; break;
      case 'category': manifest.files[0].category = 'maybe'; expected = /明确分类/; break;
      case 'digest-shape': manifest.files[0].sha256 = 'A'.repeat(64); expected = /SHA-256/; break;
      case 'omitted-required': manifest.files = manifest.files.filter((entry: { path: string }) => entry.path !== 'src.ts'); expected = /遗漏制作输入/; break;
      case 'symlink': rmSync(join(project, 'src.ts')); symlinkSync(join(project, 'card.json'), join(project, 'src.ts')); expected = /不是项目内普通文件/; break;
      case 'changed-source': writeFileSync(join(project, 'src.ts'), 'changed'); expected = /摘要不符/; break;
      default: throw new Error(mode);
    }
    // 只制造声明错误，断言相应错误原因，避免索引身份变化掩盖缺失领域规则。
    if (!['symlink', 'changed-source'].includes(mode)) writeFileSync(path, JSON.stringify(manifest));
    const result = (await verify(t, project, archiveBaselinePath('valid.tar.gz')));
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(JSON.stringify(result.report), expected);
  });
}

/** 测试从独立旧字节变造单个物理头；不依赖新 Node writer 构造 expected。 */
function physical(tar: Buffer) {
  const entries: { offset: number; name: string; type: string; size: number }[] = [];
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '');
    const size = parseInt(header.subarray(124, 136).toString(), 8);
    entries.push({ offset, name, type: header.subarray(156, 157).toString(), size });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}
function checksum(tar: Buffer, offset: number) {
  tar.fill(32, offset + 148, offset + 156);
  const sum = tar.subarray(offset, offset + 512).reduce((sum, byte) => sum + byte, 0);
  tar.write(sum.toString(8).padStart(6, '0') + '\0 ', offset + 148, 'ascii');
}
for (const type of ['1', '2', '3', '4', '5', '6', '7', 'S', 'L', 'K', 'Q']) {
  test(`真实 Node 入口明确拒绝范围外 tar 成员类型 ${type}`, async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
    const project = fixture(t);
    const tar = gunzipSync(readFileSync(archiveBaselinePath('valid.tar.gz')));
    const member = physical(tar).find(entry => entry.name === 'src.ts')!;
    tar.write(type, member.offset + 156, 'ascii'); checksum(tar, member.offset);
    const archive = join(project, 'unsupported.tar.gz'); writeFileSync(archive, gzipSync(tar));
    const result = (await verify(t, project, archive));
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(JSON.stringify(result.report), /不支持|不是普通文件/);
  });
}

/** 独立测试物理记录构造；只依照 PAX 的十进制字节长度 framing，expected 来自原成员。 */
function paxRecord(key: string, value: string) {
  const body = Buffer.from(` ${key}=${value}\n`);
  let length = body.length + 1;
  while (String(length).length + body.length !== length) length = String(length).length + body.length;
  return Buffer.concat([Buffer.from(String(length)), body]);
}
function paxBlock(template: Buffer, body: Buffer, type = 'x') {
  const header = Buffer.from(template);
  header.write(body.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  header.write(type, 156, 'ascii'); checksum(header, 0);
  return Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512)]);
}
for (const key of ['mtime', 'atime', 'ctime']) {
  for (const value of ['1e-07', '-1e-07', 'NaN', 'Infinity', '1e400', '1e-', '1e-07junk']) {
    test(`真实 Node 入口核对 PAX 时间 ${key}=${value} 的完整有限数值`, async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
      const project = fixture(t);
      const tar = gunzipSync(readFileSync(archiveBaselinePath('valid.tar.gz')));
      const local = physical(tar).find(entry => entry.type === 'x')!;
      const bytes = Buffer.concat([tar.subarray(0, local.offset), paxBlock(tar.subarray(local.offset, local.offset + 512), paxRecord(key, value)), tar.subarray(local.offset + 512 + Math.ceil(local.size / 512) * 512)]);
      const archive = join(project, 'pax-time.tar.gz'); writeFileSync(archive, gzipSync(bytes));
      const result = (await verify(t, project, archive, { ...process.env, PATH: project }));
      const accepted = value === '1e-07' || value === '-1e-07';
      assert.equal(result.status, accepted ? 0 : 1, JSON.stringify(result.report));
      if (!accepted) assert.match(JSON.stringify(result.report), /PAX .*时间无效/);
    });
  }
}
for (const mode of ['wrong-byte-length', 'truncated-record', 'invalid-utf8', 'empty-path', 'bad-size', 'negative-size', 'sparse', 'bad-octal', 'bad-header-utf8', 'unknown-format', 'after-end-member', 'nonaligned-zero-tail', 'duplicate-pax-key', 'consecutive-local-pax', 'global-pax-effective']) {
  test(`真实 Node 入口严格核对 tar/PAX 物理规则 ${mode}`, async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
    const project = fixture(t);
    let tar = gunzipSync(readFileSync(archiveBaselinePath('valid.tar.gz')));
    const entries = physical(tar);
    const local = entries.find(entry => entry.type === 'x')!;
    const source = entries.find(entry => entry.name === 'src.ts')!;
    const next = entries.find(entry => entry.name === 'card.json')!;
    const template = tar.subarray(local.offset, local.offset + 512);
    const accepted = ['nonaligned-zero-tail', 'duplicate-pax-key', 'consecutive-local-pax', 'global-pax-effective'].includes(mode);
    let body: Buffer | undefined;
    switch (mode) {
      case 'wrong-byte-length': body = Buffer.from('11 path=中文\n'); break;
      case 'truncated-record': body = Buffer.from('99 path=src.ts\n'); break;
      case 'invalid-utf8': body = paxRecord('path', 'X'); body[body.indexOf(88)] = 255; break;
      case 'empty-path': body = paxRecord('path', ''); break;
      case 'bad-size': body = paxRecord('size', '24x'); break;
      case 'negative-size': body = paxRecord('size', '-1'); break;
      case 'sparse': body = paxRecord('GNU.sparse.map', '0,24'); break;
      case 'duplicate-pax-key': body = Buffer.concat([paxRecord('path', 'wrong.ts'), paxRecord('path', 'src.ts')]); break;
      case 'consecutive-local-pax': {
        const first = paxBlock(template, paxRecord('uid', '123'));
        tar = Buffer.concat([tar.subarray(0, local.offset), first, tar.subarray(local.offset)]);
        break;
      }
      case 'global-pax-effective': {
        // 全局 path 必须应用于普通头；下一全局空值删除覆盖。局部 mtime 不改变全局 path。
        const changed = Buffer.from(tar);
        changed.fill(0, source.offset, source.offset + 100); changed.write('physical-placeholder', source.offset); checksum(changed, source.offset);
        const set = paxBlock(template, paxRecord('path', 'src.ts'), 'g');
        const clear = paxBlock(template, paxRecord('path', ''), 'g');
        tar = Buffer.concat([changed.subarray(0, local.offset), set, changed.subarray(local.offset, next.offset), clear, changed.subarray(next.offset)]);
        break;
      }
      case 'bad-octal': tar.write('0000000002x\0', source.offset + 124, 'ascii'); checksum(tar, source.offset); break;
      case 'bad-header-utf8': tar[source.offset] = 255; checksum(tar, source.offset); break;
      case 'unknown-format': tar.write('other!', source.offset + 257, 'ascii'); checksum(tar, source.offset); break;
      case 'after-end-member': tar = Buffer.concat([tar, tar.subarray(source.offset, source.offset + 1024)]); break;
      case 'nonaligned-zero-tail': {
        const last = entries.at(-1)!;
        const end = last.offset + 512 + Math.ceil(last.size / 512) * 512;
        tar = Buffer.concat([tar.subarray(0, end), Buffer.alloc(1031)]);
        break;
      }
      default: throw new Error(mode);
    }
    if (body) tar = Buffer.concat([tar.subarray(0, local.offset), paxBlock(template, body), tar.subarray(local.offset + 512 + Math.ceil(local.size / 512) * 512)]);
    const archive = join(project, 'pax-test.tar.gz'); writeFileSync(archive, gzipSync(tar));
    const result = (await verify(t, project, archive, { ...process.env, PATH: project }));
    assert.equal(result.status, accepted ? 0 : 1, JSON.stringify(result.report) + result.stderr);
    assert.equal(result.report.status, accepted ? 'passed' : 'failed');
    if (accepted) assert.deepEqual(result.report.details.order, archiveBaseline.success.legacyResult.details!.order);
    if (mode === 'bad-octal') assert.match(JSON.stringify(result.report), /八进制/);
  });
}

test('完整 gzip 对照在逐字节输入切块下仍消费零尾之后的后续流及错误', async ({  }) => {
  const { decodeArchiveGzip } = await import(pathToFileURL(resolve('scripts/production/archive-streams.mjs')).href);
  const first = gzipSync(Buffer.from('first')), second = gzipSync(Buffer.from('second'));
  async function* bytes(data: Buffer) { for (const byte of data) yield Buffer.from([byte]); }
  const output = [];
  for await (const chunk of decodeArchiveGzip(bytes(Buffer.concat([first, Buffer.alloc(7), second, Buffer.alloc(3)])))) output.push(chunk);
  assert.equal(Buffer.concat(output).toString(), 'firstsecond');
  const corrupt = Buffer.from(second); corrupt[corrupt.length - 8]! ^= 255;
  await assert.rejects(async () => { for await (const _ of decodeArchiveGzip(bytes(Buffer.concat([first, Buffer.alloc(7), corrupt])))) {} }, /check|gzip/i);
  await assert.rejects(async () => { for await (const _ of decodeArchiveGzip(bytes(Buffer.concat([first, Buffer.alloc(7), Buffer.from('junk')])))) {} }, /header|gzip/i);
});

test('真实 Node 入口顺序核对较大成员，独立旧索引和原字节只变更相应内容身份', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const project = fixture(t);
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const originalAudio = readFileSync(join(project, 'audio.wav'));
  const audio = Buffer.alloc(16 * 1024 * 1024);
  for (let offset = 0; offset < audio.length; offset += originalAudio.length) originalAudio.copy(audio, offset);
  const oldSha = hash(originalAudio), newSha = hash(audio);
  const originalManifest = readFileSync(join(project, 'production.json'));
  const manifest = Buffer.from(originalManifest.toString().replace(oldSha, newSha));
  // 从独立旧索引的原字节修改预先定义的三个身份字段，不调用新序列化器生成 expected。
  const oldIndex = readFileSync(archiveBaselinePath('expected-index.json'), 'utf8');
  const index = Buffer.from(oldIndex.replace(hash(originalManifest), hash(manifest)).replace(oldSha, newSha).replace('"size": 1280', `"size": ${audio.length}`));
  writeFileSync(join(project, 'audio.wav'), audio); writeFileSync(join(project, 'production.json'), manifest);
  const tar = gunzipSync(readFileSync(archiveBaselinePath('valid.tar.gz')));
  const parts: Buffer[] = [];
  let end = 0;
  for (const entry of physical(tar)) {
    let body = tar.subarray(entry.offset + 512, entry.offset + 512 + entry.size);
    if (entry.name === 'audio.wav') body = audio;
    if (entry.name === 'production.json') body = manifest;
    if (entry.name === '.clapgrid-package.json') body = index;
    const header = Buffer.from(tar.subarray(entry.offset, entry.offset + 512));
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii'); checksum(header, 0);
    parts.push(header, body, Buffer.alloc((512 - body.length % 512) % 512));
    end = entry.offset + 512 + Math.ceil(entry.size / 512) * 512;
  }
  parts.push(tar.subarray(end));
  const archive = join(project, 'large-member.tar.gz'); writeFileSync(archive, gzipSync(Buffer.concat(parts)));
  const result = (await verify(t, project, archive, { ...process.env, PATH: project }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(result.report.details.order, archiveBaseline.success.legacyResult.details!.order);
});
