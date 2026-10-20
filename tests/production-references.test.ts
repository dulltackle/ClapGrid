import { projectCleanup } from './helpers/project-cleanup.js';
import { command as runCommand } from './helpers/vitest-command.js';
import { test, vi, type TestContext } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';


const cli = resolve('scripts/production.mjs');
const sha = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
function fixture(t: TestContext) {
  const project = mkdtempSync(join(tmpdir(), 'clapgrid-references-'));
  projectCleanup(t).directory(project);
  const contents = { 'card.json': '{}', 'source.ts': 'source', 'audio.wav': 'audio', 'assembly.mp4': 'assembly', 'review.mp4': 'review', 'tsconfig.json': '{}' };
  for (const [name, bytes] of Object.entries(contents)) writeFileSync(join(project, name), bytes);
  const manifest = { schemaVersion: 1, project: { width: 64, height: 64, fps: 10 }, typecheck: 'tsconfig.json',
    segments: [{ id: 'A', card: 'card.json', source: 'source.ts', audio: 'audio.wav', assembly: 'assembly.mp4', review: 'review.mp4', frames: 1 }],
    files: Object.entries(contents).map(([path, bytes]) => ({ path, category: 'production', sha256: sha(bytes) })),
  };
  const save = () => writeFileSync(join(project, 'production.json'), JSON.stringify(manifest));
  const include = (name: string, bytes: string) => { writeFileSync(join(project, name), bytes); manifest.files.push({ path: name, category: 'history', sha256: sha(bytes) }); };
  const run = async (command: string, report = join(project, `${command}-report.json`), args: string[] = []) => {
    const output = (await runCommand(process.execPath, [cli, command, '--project', project, '--report', report, ...args], { encoding: 'utf8' }));
    const location = output.stdout.match(/完整报告：(.*)/)?.[1];
    assert.ok(location, output.stdout + output.stderr);
    return { ...output, report: JSON.parse(readFileSync(location, 'utf8')) };
  };
  save();
  return { project, manifest, save, include, run };
}

test('真实入口分别保护可读不合格记录中的历史和未知字段，而不强制这些引用入包', async t => {
  const f = fixture(t);
  const original = join(f.project, 'historical-report.json');
  const bytes = JSON.stringify({ schemaVersion: 1, report: original, startedAt: 'controlled-test', checks: [] });
  writeFileSync(original, bytes);
  const evidence = { reviewVersion: 'current', requirements: [], records: [{ reviewVersion: 'old', artifact: { path: 'historical-report.json' } }], extension: { nested: { artifact: 'historical-report.json' } } };
  f.include('evidence.json', JSON.stringify(evidence));
  Object.assign(f.manifest, { evidence: 'evidence.json' }); f.save();
  assert.equal((await f.run('pack')).status, 0);
  const before = readFileSync(join(f.project, 'delivery.tar.gz'));
  const collision = (await f.run('pack', original));
  assert.equal(collision.status, 1);
  assert.match(JSON.stringify(collision.report), /拒绝覆盖/);
  assert.equal(readFileSync(original, 'utf8'), bytes);
  assert.deepEqual(readFileSync(join(f.project, 'delivery.tar.gz')), before);
});

for (const mode of ['relative', 'absolute', 'file-url', 'alias', 'symlink', 'historical', 'missing', 'external'] as const) {
  test(`真实入口证明指针 ${mode} 按两种用途选择范围且保护原字节`, async t => {
    const f = fixture(t);
    const original = join(f.project, 'proof.json');
    const bytes = JSON.stringify({ schemaVersion: 1, report: original, startedAt: 'controlled-test', checks: [], original: mode });
    if (mode !== 'missing') writeFileSync(original, bytes);
    let pointer = 'proof.json';
    if (mode === 'absolute') pointer = original;
    if (mode === 'file-url') pointer = pathToFileURL(original).href;
    if (mode === 'alias') pointer = './proof.json';
    if (mode === 'symlink') { symlinkSync('proof.json', join(f.project, 'alias.json')); pointer = 'alias.json'; }
    if (mode === 'external') pointer = 'https://example.invalid/chat';
    f.include('evidence.json', JSON.stringify({ reviewVersion: 'current', requirements: [],
      records: [{ reviewVersion: mode === 'historical' ? 'old' : 'current', provenance: { record: pointer } }] }));
    Object.assign(f.manifest, { evidence: 'evidence.json' }); f.save();
    const omitted = (await f.run('pack'));
    const required = ['relative', 'absolute', 'file-url', 'alias'].includes(mode);
    assert.equal(omitted.status, required || mode === 'symlink' ? 1 : 0, omitted.stdout);
    if (required) {
      assert.match(JSON.stringify(omitted.report), /遗漏.*proof\.json/);
      assert.equal(existsSync(join(f.project, 'delivery.tar.gz')), false);
      // 作者补充声明后，pack 及 verify-package 均实际接受同一引用范围。
      f.manifest.files.push({ path: 'proof.json', category: 'history', sha256: sha(bytes) }); f.save();
      assert.equal((await f.run('pack')).status, 0);
      assert.equal((await f.run('verify-package', undefined, ['--archive', 'delivery.tar.gz'])).status, 0);
      f.manifest.files = f.manifest.files.filter(file => file.path !== 'proof.json'); f.save();
      const verified = (await f.run('verify-package', undefined, ['--archive', 'delivery.tar.gz']));
      assert.equal(verified.status, 1);
      assert.match(JSON.stringify(verified.report), /遗漏.*proof\.json/);
    }
    if (mode === 'symlink') assert.match(JSON.stringify(omitted.report), /符号链接.*alias\.json/);
    if (mode !== 'missing' && mode !== 'external') {
      const collision = (await f.run('pack', original));
      assert.equal(collision.status, 1);
      assert.match(JSON.stringify(collision.report), /拒绝覆盖/);
      assert.equal(readFileSync(original, 'utf8'), bytes);
    }
    assert.deepEqual(JSON.parse(readFileSync(join(f.project, 'evidence.json'), 'utf8')).records[0].provenance.record, pointer);
  });
}

test('当前要求的相对别名定位为必需成员，待生成目标保护报告但不强制入包', async t => {
  const f = fixture(t);
  writeFileSync(join(f.project, 'artifact.txt'), 'artifact bytes');
  f.include('evidence.json', JSON.stringify({ reviewVersion: 'current', records: [], requirements: [{ required: [{ artifact: './artifact.txt' }, { artifact: 'future.txt' }] }] }));
  Object.assign(f.manifest, { evidence: 'evidence.json' }); f.save();
  const omitted = (await f.run('pack'));
  assert.equal(omitted.status, 1); assert.match(JSON.stringify(omitted.report), /遗漏.*artifact\.txt/);
  assert.doesNotMatch(JSON.stringify(omitted.report), /遗漏.*future\.txt/);
  f.manifest.files.push({ path: 'artifact.txt', category: 'technical', sha256: sha('artifact bytes') }); f.save();
  assert.equal((await f.run('pack')).status, 0);
  const before = readFileSync(join(f.project, 'delivery.tar.gz'));
  const protectedMissing = (await f.run('pack', join(f.project, 'future.txt')));
  assert.equal(protectedMissing.status, 1); assert.match(JSON.stringify(protectedMissing.report), /拒绝覆盖/);
  assert.equal(existsSync(join(f.project, 'future.txt')), false);
  assert.deepEqual(readFileSync(join(f.project, 'delivery.tar.gz')), before);
});

test('不可写的已有报告在归档副作用前被拒绝并保留原件', async t => {
  const f = fixture(t);
  const original = join(f.project, 'readonly.json');
  const bytes = JSON.stringify({ schemaVersion: 1, report: original, startedAt: 'controlled-test', checks: [] });
  writeFileSync(original, bytes); chmodSync(original, 0o444);
  const failed = (await f.run('pack', original));
  assert.equal(failed.status, 1, failed.stdout);
  assert.match(JSON.stringify(failed.report), /报告无法写入.*命令尚未执行/);
  assert.equal(existsSync(join(f.project, 'delivery.tar.gz')), false);
  assert.equal(readFileSync(original, 'utf8'), bytes);
});

for (const field of ['sample', 'dependencies', 'assets']) test(`归档不能把显式不合格 ${field} 当作缺省空记录`, async t => {
  const f = fixture(t);
  if (field === 'assets') Object.assign(f.manifest.segments[0]!, { assets: null });
  else Object.assign(f.manifest, { [field]: null });
  f.save();
  const failed = (await f.run('pack'));
  assert.equal(failed.status, 1, failed.stdout);
  assert.equal(failed.report.status, 'failed');
  assert.equal(existsSync(join(f.project, 'delivery.tar.gz')), false);
});

for (const location of ['current-artifact', 'historical-path', 'extension-path'] as const) test(`本地文件网址在 ${location} 中仍保护旧报告形状的原件`, async t => {
  const f = fixture(t);
  const original = join(f.project, 'original.json');
  const bytes = JSON.stringify({ schemaVersion: 1, report: original, startedAt: 'controlled-test', checks: [], original: location });
  writeFileSync(original, bytes);
  const pointer = pathToFileURL(original).href;
  const evidence = { reviewVersion: 'current', requirements: [], records: [] };
  if (location === 'current-artifact') Object.assign(evidence, { requirements: [{ required: [{ artifact: pointer }] }] });
  if (location === 'historical-path') Object.assign(evidence, { records: [{ reviewVersion: 'old', artifact: { path: pointer } }] });
  if (location === 'extension-path') Object.assign(evidence, { unknownExtension: { path: pointer } });
  f.include('evidence.json', JSON.stringify(evidence));
  Object.assign(f.manifest, { evidence: 'evidence.json' }); f.save();
  const collision = (await f.run('pack', original));
  assert.equal(collision.status, 1);
  assert.match(JSON.stringify(collision.report), /拒绝覆盖/);
  assert.equal(readFileSync(original, 'utf8'), bytes);
  assert.equal(existsSync(join(f.project, 'delivery.tar.gz')), false);
});

for (const pointerStyle of ['relative-file', 'encoded-slash'] as const) for (const referenceField of ['artifact', 'proof'] as const) {
  test(`本地 ${pointerStyle} 的 ${referenceField} 指针沿用兼容解析且保护原件`, async t => {
    const f = fixture(t);
    mkdirSync(join(f.project, 'folder'));
    const original = join(f.project, 'folder/original.json');
    const bytes = JSON.stringify({ schemaVersion: 1, report: original, startedAt: 'controlled-test', checks: [], original: `${pointerStyle}/${referenceField}` });
    writeFileSync(original, bytes);
    const pointer = pointerStyle === 'relative-file' ? 'file:folder/original.json' : `file://${f.project}/folder%2Foriginal.json`;
    const evidence = { reviewVersion: 'current', requirements: [], records: [] };
    if (referenceField === 'artifact') Object.assign(evidence, { requirements: [{ required: [{ artifact: pointer }] }] });
    else Object.assign(evidence, { records: [{ reviewVersion: 'current', provenance: { record: pointer } }] });
    f.include('evidence.json', JSON.stringify(evidence));
    Object.assign(f.manifest, { evidence: 'evidence.json' }); f.save();
    const omitted = (await f.run('pack'));
    assert.equal(omitted.status, 1);
    assert.match(JSON.stringify(omitted.report), /遗漏.*folder\/original\.json/);
    const collision = (await f.run('pack', original));
    assert.equal(collision.status, 1);
    assert.match(JSON.stringify(collision.report), /拒绝覆盖/);
    assert.equal(readFileSync(original, 'utf8'), bytes);
    assert.equal(existsSync(join(f.project, 'delivery.tar.gz')), false);
  });
}
