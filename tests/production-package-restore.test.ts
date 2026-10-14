import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { archiveBaseline as catalog, archiveBaselinePath } from './helpers/archive-baseline.js';
import { restorePackage, packageEnd } from './helpers/production-package.js';

const cli = resolve('scripts/production.mjs');
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
function run(project: string, command: string, archive?: string) {
  const report = join(project, `report-${command}.json`);
  const result = spawnSync(process.execPath, [cli, command, '--project', project, '--report', report, ...(archive ? ['--archive', archive] : [])], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return { ...result, report: JSON.parse(readFileSync(report, 'utf8')) };
}

for (const kind of ['valid.tar.gz', 'valid-python-3.12.tar.gz', 'pax-overrides.tar.gz', 'new-node']) {
  test(`独立空目录恢复 ${kind}，全成员/清单/索引按冻结旧字节与摘要核对后真实入口再验`, async t => {
    const project = mkdtempSync(join(tmpdir(), 'clapgrid-restore-source-'));
    const restored = mkdtempSync(join(tmpdir(), 'clapgrid-restore-independent-'));
    t.after(() => { rmSync(project, { recursive: true, force: true }); rmSync(restored, { recursive: true, force: true }); });
    cpSync(archiveBaselinePath('project'), project, { recursive: true });
    let archive = archiveBaselinePath(kind);
    if (kind === 'new-node') {
      const packed = run(project, 'pack');
      assert.equal(packed.status, 0, packed.stdout + packed.stderr);
      archive = join(project, 'delivery.tar.gz');
    }
    const archiveBefore = readFileSync(archive);
    // 包结束位置独立按物理 PAX/有效普通 size 推进；覆盖 size=13 而普通头 size=0 的旧包。
    const raw = gunzipSync(archiveBefore);
    const end = packageEnd(raw);
    assert.ok(raw.subarray(end).every(byte => byte === 0));
    const members = await restorePackage(archive, restored);
    assert.deepEqual(members.map(member => member.header.name), catalog.success.legacyResult.details!.order);
    for (const expected of catalog.success.members) {
      const original = expected.path === '.clapgrid-package.json' ? archiveBaselinePath('expected-index.json') : archiveBaselinePath('project/' + expected.path);
      const bytes = readFileSync(join(restored, expected.path));
      assert.deepEqual(bytes, readFileSync(original), expected.path);
      assert.equal(bytes.length, expected.size, expected.path);
      assert.equal(hash(bytes), expected.sha256, expected.path);
    }
    const verified = run(restored, 'verify-package', archive);
    assert.equal(verified.status, 0, verified.stdout + verified.stderr);
    assert.deepEqual(verified.report.details.order, catalog.success.legacyResult.details!.order);
    assert.deepEqual(readFileSync(archive), archiveBefore);
  });
}

test('独立恢复审阅历史与证明原件，待审/否决/受控测试/人工声明保持原字节和相同证据门槛', async t => {
  const project = mkdtempSync(join(tmpdir(), 'clapgrid-history-source-'));
  const restored = mkdtempSync(join(tmpdir(), 'clapgrid-history-restored-'));
  t.after(() => { rmSync(project, { recursive: true, force: true }); rmSync(restored, { recursive: true, force: true }); });
  cpSync(archiveBaselinePath('project'), project, { recursive: true });
  const proof = '证明原件.json', artifact = '审阅产物.txt';
  const contents: Record<string, string> = {
    [proof]: '{"source":"controlled-test","original":"证明原件，不是真实宿主或人工观察"}\n',
    [artifact]: '固定审阅产物\n',
    '历史待审.json': '{"status":"pending","reviewVersion":"old"}\n',
    '历史否决.json': '{"status":"denied","reviewVersion":"old"}\n',
    '人工确认.json': '{"source":"human","status":"passed","scope":["old"]}\n',
  };
  const record = { requirement: 'R', criterion: 'technical', kind: 'ran', artifact: { path: artifact, sha256: hash(contents[artifact]!) }, scope: ['A'], source: 'controlled-test', provenance: { actor: '受控测试', record: proof, observedAt: '2026-10-14T00:00:00Z' } };
  contents['证据.json'] = JSON.stringify({ schemaVersion: 1, reviewVersion: 'current', requirements: [{ id: 'R', classifiedBy: { source: 'human', identity: '受控回归配置' }, required: [{ id: 'technical', kind: 'ran', artifact, scope: ['A'] }] }], records: [
    { ...record, id: 'old-pending', reviewVersion: 'old', status: 'pending', artifact: { path: '历史待审.json', sha256: hash(contents['历史待审.json']!) } },
    { ...record, id: 'old-denied', reviewVersion: 'old', status: 'denied', artifact: { path: '历史否决.json', sha256: hash(contents['历史否决.json']!) } },
    { ...record, id: 'current-test', reviewVersion: 'current', status: 'passed' },
  ] }) + '\n';
  const entries = Object.entries(contents).map(([path, bytes]) => {
    writeFileSync(join(project, path), bytes);
    return JSON.stringify({ path, sha256: hash(bytes), category: path.startsWith('历史') ? 'history' : path === '人工确认.json' ? 'user' : 'technical' });
  });
  const manifest = join(project, 'production.json');
  const original = readFileSync(manifest, 'utf8');
  assert.ok(original.includes('"files":[\n '));
  writeFileSync(manifest, original.replace('"files":[\n ', '"evidence":"证据.json","files":[\n ' + entries.join(',\n ') + ',\n '));
  const before = run(project, 'evidence');
  assert.equal(before.status, 0, before.stdout);
  assert.equal(before.report.details.requirements[0].controlledTest, true);
  assert.equal(before.report.details.requirements[0].writeBackAllowed, false);
  assert.equal(run(project, 'pack').status, 0);
  const archive = join(project, 'delivery.tar.gz');
  const members = await restorePackage(archive, restored);
  assert.deepEqual(members.map(member => member.header.name).sort(), ['.clapgrid-package.json', 'production.json', ...catalog.success.members.filter(member => !['.clapgrid-package.json', 'production.json'].includes(member.path)).map(member => member.path), ...Object.keys(contents)].sort());
  for (const [path, bytes] of Object.entries(contents)) {
    assert.deepEqual(readFileSync(join(restored, path)), Buffer.from(bytes), path);
    assert.equal(hash(readFileSync(join(restored, path))), hash(bytes), path);
  }
  assert.deepEqual(readFileSync(join(restored, 'production.json')), readFileSync(manifest));
  const index = members.find(member => member.header.name === '.clapgrid-package.json')!.body;
  assert.deepEqual(readFileSync(join(restored, '.clapgrid-package.json')), index);
  const verified = run(restored, 'verify-package', archive);
  assert.equal(verified.status, 0, verified.stdout);
  const after = run(restored, 'evidence');
  assert.equal(after.status, before.status, after.stdout);
  assert.equal(after.report.details.reviewVersion, before.report.details.reviewVersion);
  assert.deepEqual(after.report.details.requirements, before.report.details.requirements);
  assert.equal(readdirSync(restored).includes('历史否决.json'), true);
});
