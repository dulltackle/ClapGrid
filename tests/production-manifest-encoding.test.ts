import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

// 原 Node 文件未设置测试及清理时限；仅本迁移文件保留相同语义。
vi.setConfig({ testTimeout: 0, hookTimeout: 0 });

const root = resolve('tests/fixtures/production-manifest-encoding');
const catalog = JSON.parse(readFileSync(join(root, 'catalog.json'), 'utf8')) as {
  cases: { name: string; success: boolean; manifestSha256: string; versions: { archive?: string; archiveSha256?: string; indexSha256?: string; results: { exit: number }[] }[] }[];
};
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function member(archive: Buffer, name: string) {
  const raw = gunzipSync(archive);
  for (let cursor = 0; cursor < raw.length; ) {
    const header = raw.subarray(cursor, cursor + 512);
    const path = header.subarray(0,100).toString().replace(/\0.*$/, '');
    const size = parseInt(header.subarray(124,136).toString(),8) || 0;
    if (path === name) return raw.subarray(cursor + 512,cursor + 512 + size);
    cursor += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('缺少成员：' + name);
}
for (const entry of catalog.cases) {
  test(`真实 Node 清单码点身份与两旧入口一致：${entry.name}`, t => {
    const project = mkdtempSync(join(tmpdir(), 'clapgrid-manifest-'));
    t.onTestFinished(() => rmSync(project,{recursive:true,force:true}));
    cpSync(join(root,entry.name,'project'),project,{recursive:true});
    const manifest = readFileSync(join(project,'production.json'));
    assert.equal(sha(manifest),entry.manifestSha256);
    for (const version of entry.versions) for (const result of version.results) assert.equal(result.exit,entry.success ? 0 : 1);
    const call = (command: string, archive: string) => spawnSync(process.execPath,[resolve('scripts/production.mjs'),command,'--project',project,'--report',join(project,'report.json'),command==='pack'?'--output':'--archive',archive],{encoding:'utf8',env:{...process.env,PATH:project}});
    for (const version of entry.versions) if (entry.success) {
      const archive = join(root,entry.name,version.archive!);
      const oldBytes = readFileSync(archive), expectedIndex = readFileSync(join(root,entry.name,'expected-index.json'));
      assert.equal(sha(oldBytes),version.archiveSha256);
      assert.equal(sha(expectedIndex),version.indexSha256);
      assert.deepEqual(member(oldBytes,'.clapgrid-package.json'),expectedIndex);
      assert.deepEqual(member(oldBytes,'production.json'),manifest);
      const verified = call('verify-package',archive);
      assert.equal(verified.status,0,verified.stdout+verified.stderr);
    }
    const archive = join(project,'new.tar.gz'), packed = call('pack',archive);
    assert.equal(packed.status,entry.success ? 0 : 1,packed.stdout+packed.stderr);
    if (entry.success) {
      const bytes = readFileSync(archive);
      assert.deepEqual(member(bytes,'production.json'),manifest);
      assert.deepEqual(member(bytes,'.clapgrid-package.json'),readFileSync(join(root,entry.name,'expected-index.json')));
      const verified = call('verify-package',archive);
      assert.equal(verified.status,0,verified.stdout+verified.stderr);
    } else assert.match(packed.stdout,/surrogate|编码/);
    assert.deepEqual(readFileSync(join(project,'production.json')),manifest);
  });
}

test('v1 字符串按 Python 码点保持键身份、重复覆盖位置，并允许 UTF16 正常对', async () => {
  const { parseV1, dumpV1, v1Object } = await import(pathToFileURL(resolve('scripts/production/archive-v1.mjs')).href);
  const pair = Buffer.from('eda0bdedb880','hex');
  const tree = v1Object(parseV1(Buffer.concat([Buffer.from('{"'),pair,Buffer.from('\":1,"😀":2,"'),pair,Buffer.from('\":3,"tail":4}')])));
  assert.equal(tree.size,3);
  assert.equal([...tree.values()][0].value,3n);
  assert.equal(tree.get('😀') && (tree.get('😀') as {value:bigint}).value,2n);
  assert.throws(() => dumpV1(tree),/surrogate/);
  assert.equal(dumpV1(parseV1(Buffer.from('{"x":"\\ud83d\\ude00"}'))).toString(),'{\n  "x": "😀"\n}\n');
  assert.equal(dumpV1(parseV1(Buffer.from('{"x":"😀"}','utf16le'))).toString(),'{\n  "x": "😀"\n}\n');
  const duplicate = v1Object(parseV1(Buffer.concat([Buffer.from('{"'),Buffer.from('eda080','hex'),Buffer.from('\":1,"\\ud800":2,"tail":3}')])));
  assert.equal(duplicate.size,2);
  assert.equal([...duplicate.values()][0].value,2n);
  for (const bytes of [Buffer.from('c080','hex'),Buffer.from('edbfff80','hex')]) assert.throws(() => parseV1(Buffer.concat([Buffer.from('"'),bytes,Buffer.from('"')])));
});

// 独立旧入口范围探针确认这些编码/类型在 Node 前置 schema 已失败，不能因 Python 解码器放宽。
for (const variant of ['utf8-bom','utf16','schema-true']) test(`制作清单保留旧 Native 前置范围：${variant}`, t => {
  const project = mkdtempSync(join(tmpdir(),'clapgrid-manifest-range-'));
  t.onTestFinished(() => rmSync(project,{recursive:true,force:true}));
  cpSync(join(root,'escaped-pair','project'),project,{recursive:true});
  const path = join(project,'production.json'), raw = readFileSync(path);
  writeFileSync(path,variant === 'utf8-bom' ? Buffer.concat([Buffer.from('efbbbf','hex'),raw]) : variant === 'utf16' ? Buffer.from(raw.toString(),'utf16le') : Buffer.from(raw.toString().replace('"schemaVersion":1','"schemaVersion":true')));
  for (const command of ['pack','verify-package']) {
    const result = spawnSync(process.execPath,[resolve('scripts/production.mjs'),command,'--project',project,'--report',join(project,'report.json'),command==='pack'?'--output':'--archive',command==='pack'?join(project,'new.tar.gz'):join(root,'escaped-pair','legacy-3.12.tar.gz')],{encoding:'utf8',env:{...process.env,PATH:project}});
    assert.equal(result.status,1,result.stdout+result.stderr);
  }
});
