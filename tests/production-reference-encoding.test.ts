import { test, vi, type TestContext } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// 原 Node 文件未设置测试及清理时限；仅本迁移文件保留相同语义。
vi.setConfig({ testTimeout: 0, hookTimeout: 0 });

const root = resolve('tests/fixtures/production-reference-encoding');
const cli = resolve('scripts/production.mjs');
interface EncodingCase { name: string; encoding: string; proof: string; requiresProof: boolean; identities: { path: string; size: number; sha256: string }[];
  versions: { python: string; archive: string; sha256: string; size: number; results: { exit: number; report: { status: string } }[] }[] }
const catalog = JSON.parse(readFileSync(join(root, 'catalog.json'), 'utf8')) as { cases: EncodingCase[] };
function fixture(t: TestContext, name: string) {
  const item = catalog.cases.find(item => item.name === name)!;
  assert.ok(item, name);
  const project = mkdtempSync(join(tmpdir(), 'clapgrid-reference-encoding-'));
  cpSync(join(root, name, 'project'), project, { recursive: true });
  t.onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  const manifest = JSON.parse(readFileSync(join(project, 'production.json'), 'utf8')) as { files: { path: string }[] };
  const save = () => writeFileSync(join(project, 'production.json'), JSON.stringify(manifest));
  const run = (report = join(project, 'report.json'), archive = item.versions[0]!.archive) => {
    const result = spawnSync(process.execPath, [cli, 'verify-package', '--project', project, '--archive', join(root, name, archive), '--report', report], { encoding: 'utf8', env: { ...process.env, PATH: project } });
    assert.equal(result.error, undefined);
    const location = result.stdout.match(/完整报告：(.*)/)?.[1];
    assert.ok(location, result.stdout + result.stderr);
    return { ...result, report: JSON.parse(readFileSync(location, 'utf8')) };
  };
  return { item, project, manifest, save, run };
}

test('真实Node入口接受两个旧Python版本独立生成的UTF8 BOM证据包且保留原始字节', t => {
  const f = fixture(t, 'utf8-bom');
  const before = readFileSync(join(f.project, 'evidence.json'));
  for (const version of f.item.versions) {
    const result = f.run(undefined, version.archive);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.report.status, 'passed');
    assert.deepEqual(readFileSync(join(f.project, 'evidence.json')), before);
  }
});

test('真实Node入口接受旧UTF16LE BOM证据并正确定位含非BMP字符的原件', t => {
  const f = fixture(t, 'utf16-le-bom');
  for (const version of f.item.versions) {
    const result = f.run(undefined, version.archive);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  f.manifest.files = f.manifest.files.filter(file => file.path !== f.item.proof); f.save();
  const omitted = f.run();
  assert.equal(omitted.status, 1);
  assert.match(JSON.stringify(omitted.report), /遗漏.*原件NaN Infinity -Infinity😀\.json/);
});

for (const item of catalog.cases.filter(item => !['utf8-bom', 'utf16-le-bom', 'constants'].includes(item.name) && !/(?:current|history)$/.test(item.name))) {
  test(`真实入口核对独立旧 ${item.name} 包，自动识别端序与无BOM编码且原件不变`, t => {
    const f = fixture(t, item.name);
    for (const version of item.versions) {
      const archive = join(root, item.name, version.archive);
      assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'), version.sha256);
      assert.ok(version.results.every(result => result.exit === 0 && result.report.status === 'passed'));
      const result = f.run(undefined, version.archive);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    for (const identity of item.identities) {
      const raw = readFileSync(join(f.project, identity.path));
      assert.equal(raw.length, identity.size);
      assert.equal(createHash('sha256').update(raw).digest('hex'), identity.sha256);
    }
  });
}

test('真实入口接受旧Python证据NaN与正负Infinity，保留字符串及当前版本的选择意义', t => {
  const f = fixture(t, 'constants');
  for (const version of f.item.versions) {
    const result = f.run(undefined, version.archive);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  f.manifest.files = f.manifest.files.filter(file => file.path !== f.item.proof); f.save();
  const omitted = f.run();
  assert.equal(omitted.status, 1);
  assert.match(JSON.stringify(omitted.report), /遗漏.*原件NaN Infinity -Infinity😀\.json/);
});

for (const item of catalog.cases) for (const role of ['current', 'historical', 'extension'] as const) {
  test(`${item.name} 的${role}原件即使形似旧报告也不可覆盖，失败报告可定位且编码字节不变`, t => {
    const f = fixture(t, item.name);
    const name = role === 'current' ? item.proof : role === 'historical' ? '历史😀.json' : '扩展😀.json';
    if (role === 'current') { f.manifest.files = f.manifest.files.filter(file => file.path !== item.proof); f.save(); }
    const original = join(f.project, name);
    const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, report: original, startedAt: 'controlled-test', checks: [], original: role }));
    writeFileSync(original, bytes);
    const evidenceBefore = readFileSync(join(f.project, 'evidence.json'));
    const manifestBefore = readFileSync(join(f.project, 'production.json'));
    const result = f.run(original);
    assert.equal(result.status, 1);
    assert.match(JSON.stringify(result.report), /拒绝覆盖/);
    assert.notEqual(result.report.report, original);
    assert.deepEqual(readFileSync(original), bytes);
    assert.deepEqual(readFileSync(join(f.project, 'evidence.json')), evidenceBefore);
    assert.deepEqual(readFileSync(join(f.project, 'production.json')), manifestBefore);
  });
}

const malformed: [string, Buffer][] = [
  ['UTF16-奇数', Buffer.from([0xff, 0xfe, 0x7b])],
  ['UTF32LE-截断', Buffer.from([0xff, 0xfe, 0, 0, 0x7b, 0, 0])],
  ['UTF32BE-截断', Buffer.from([0, 0, 0xfe, 0xff, 0, 0, 0])],
  ['UTF32-越界码点', Buffer.from([0xff, 0xfe, 0, 0, 0, 0, 0x11, 0])],
  ['UTF8-截断', Buffer.from([0xf0, 0x9f, 0x98])],
  ['UTF8-过长编码', Buffer.from([0xc0, 0xaf])],
  ['UTF8-坏代理字符', Buffer.from([0xed, 0xa0, 0x41])],
  ['重复BOM', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf]), Buffer.from('{}')])],
  ...['{"x":+Infinity}', '{"x":NaNfoo}', '{"x":-NaN}', '{"x":infinity}', '{"x":/*Infinity*/1}', "{'x':NaN}", '{"x":Infinity,}', '{"x":NaN 0}'].map(raw => [raw, Buffer.from(raw)] as [string, Buffer]),
];
for (const [name, raw] of malformed) test(`证据 ${name} 明确失败，不放宽为JSON5或吞掉编码损坏`, t => {
  const f = fixture(t, 'utf8');
  writeFileSync(join(f.project, 'evidence.json'), raw);
  Object.assign(f.manifest.files.find(file => file.path === 'evidence.json')!, { sha256: createHash('sha256').update(raw).digest('hex') }); f.save();
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(JSON.stringify(result.report), /证据文件编码或 JSON 无效.*evidence\.json/);
  assert.deepEqual(readFileSync(join(f.project, 'evidence.json')), raw);
});

for (const item of catalog.cases.filter(item => /(?:current|history)$/.test(item.name))) {
  test(`旧 ${item.name} 审阅版本精确比较继续区分当前与历史，避免误强制入包`, t => {
    const f = fixture(t, item.name);
    for (const version of item.versions) {
      const result = f.run(undefined, version.archive);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    assert.equal(f.manifest.files.some(file => file.path === item.proof), item.requiresProof);
    if (item.requiresProof) {
      f.manifest.files = f.manifest.files.filter(file => file.path !== item.proof); f.save();
      const omitted = f.run();
      assert.equal(omitted.status, 1);
      assert.match(JSON.stringify(omitted.report), /遗漏.*原件NaN Infinity -Infinity😀\.json/);
    }
  });
}

for (const field of ['path', 'proof', 'manifest'] as const) test(`旧Node可读取的非法UTF8-unused ${field} 数据仍保护原件，严格归档不成为覆盖漏洞`, t => {
  const f = fixture(t, 'utf8');
  const name = field === 'manifest' ? 'source.ts' : f.item.proof;
  const original = join(f.project, name);
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, report: original, startedAt: 'controlled-test', checks: [], original: field }));
  writeFileSync(original, bytes);
  let raw;
  if (field === 'manifest') {
    Object.assign(f.manifest, { unused: 'INVALIDBYTE' });
    raw = Buffer.from(JSON.stringify(f.manifest));
  } else {
    const evidence = JSON.parse(readFileSync(join(f.project, 'evidence.json'), 'utf8'));
    if (field === 'proof') delete evidence.records[0].artifact;
    else delete evidence.records[0].provenance;
    evidence.unknownExtension.unused = 'INVALIDBYTE';
    raw = Buffer.from(JSON.stringify(evidence));
    f.manifest.files = f.manifest.files.filter(file => file.path !== f.item.proof); f.save();
  }
  const marker = raw.indexOf('INVALIDBYTE');
  raw = Buffer.concat([raw.subarray(0, marker), Buffer.from([0xff]), raw.subarray(marker + 'INVALIDBYTE'.length)]);
  const input = join(f.project, field === 'manifest' ? 'production.json' : 'evidence.json');
  writeFileSync(input, raw);
  const result = f.run(original);
  assert.equal(result.status, 1);
  assert.match(JSON.stringify(result.report), /拒绝覆盖/);
  assert.notEqual(result.report.report, original);
  assert.deepEqual(readFileSync(original), bytes);
  assert.deepEqual(readFileSync(input), raw);
});

for (const pair of [false, true]) for (const field of ['path', 'proof'] as const) test(`原Node的${pair ? 'paired' : 'single'} raw surrogate ${field}投影仍保护既有原件`, t => {
  const f = fixture(t, 'utf8');
  const surrogate = Buffer.from(pair ? [0xed, 0xa0, 0xbd, 0xed, 0xb8, 0x80] : [0xed, 0xa0, 0x80]);
  const name = surrogate.toString('utf8') + '.json';
  const original = join(f.project, name);
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, report: original, startedAt: 'controlled-test', checks: [], original: field }));
  writeFileSync(original, bytes);
  const extension = field === 'path' ? '"path":"RAWNAME.json"' : '"provenance":{"record":"RAWNAME.json"}';
  const source = Buffer.from('{"requirements":[],"records":[],"unknownExtension":{' + extension + '}}');
  const offset = source.indexOf('RAWNAME');
  const raw = Buffer.concat([source.subarray(0, offset), surrogate, source.subarray(offset + 7)]);
  writeFileSync(join(f.project, 'evidence.json'), raw);
  Object.assign(f.manifest.files.find(file => file.path === 'evidence.json')!, { sha256: createHash('sha256').update(raw).digest('hex') }); f.save();
  const result = f.run(original);
  assert.equal(result.status, 1);
  assert.match(JSON.stringify(result.report), /拒绝覆盖/);
  assert.notEqual(result.report.report, original);
  assert.deepEqual(readFileSync(original), bytes);
  assert.deepEqual(readFileSync(join(f.project, 'evidence.json')), raw);
});
