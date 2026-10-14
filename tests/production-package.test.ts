import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inspect, rewrite, corruptRawPackage, restorePackage } from './helpers/production-package.js';

const cli = resolve('scripts/production.mjs');
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
function fixture() {
  const project = mkdtempSync(join(tmpdir(), 'clapgrid-归档 项目-'));
  const contents: Record<string, string | Buffer> = {
    'src.ts': 'export const scene = 1;\n', '配音.wav': Buffer.alloc(1027, 21),
    '装配.mp4': Buffer.alloc(2181, 32), '审阅.mp4': Buffer.alloc(3311, 43),
    'card.json': JSON.stringify({ segments: [{ id: 'A', source: 'src.ts', audio: '配音.wav' }] }),
    'tsconfig.json': '{}', '历史待审.json': '{"status":"pending"}',
    '用户确认.json': '{"source":"controlled-test","status":"approved"}',
  };
  for (const [name, bytes] of Object.entries(contents)) writeFileSync(join(project, name), bytes);
  const manifest = {
    schemaVersion: 1, project: { width: 64, height: 64, fps: 10 }, typecheck: 'tsconfig.json',
    segments: [{ id: 'A', card: 'card.json', source: 'src.ts', audio: '配音.wav', frames: 6, assembly: '装配.mp4', review: '审阅.mp4' }],
    files: Object.entries(contents).map(([path, data]) => ({ path, sha256: hash(data), category: path === '历史待审.json' ? 'history' : path === '用户确认.json' ? 'user' : path === 'tsconfig.json' ? 'technical' : 'production' })),
  };
  writeFileSync(join(project, 'production.json'), JSON.stringify(manifest, null, 2));
  return { project, contents, manifest, save: () => writeFileSync(join(project, 'production.json'), JSON.stringify(manifest, null, 2)) };
}
function run(project: string, command: string, args: string[] = []) {
  const report = join(project, `report-${command}.json`);
  const result = spawnSync(process.execPath, [cli, command, '--project', project, '--report', report, ...args], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  assert.ok(existsSync(report), result.stderr + result.stdout);
  return { ...result, report: JSON.parse(readFileSync(report, 'utf8')) };
}
test('真实入口从清单生成完整归档，清单自身及不同大小成员字节准确，历史与人工记录原样保留', async t => {
  const f = fixture(); t.after(() => rmSync(f.project, { recursive: true, force: true }));
  const result = run(f.project, 'pack');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.report.status, 'passed');
  const archive = join(f.project, 'delivery.tar.gz');
  const members = await inspect(archive);
  assert.deepEqual(Object.keys(members).sort(), [...Object.keys(f.contents), 'production.json', '.clapgrid-package.json'].sort());
  for (const [name, bytes] of Object.entries(f.contents)) {
    assert.equal(members[name], Buffer.from(bytes).toString('base64'));
    assert.deepEqual(readFileSync(join(f.project, name)), Buffer.from(bytes));
  }
  assert.equal(members['production.json'], readFileSync(join(f.project, 'production.json')).toString('base64'));
  const index = JSON.parse(Buffer.from(members['.clapgrid-package.json']!, 'base64').toString());
  assert.equal(index.manifest.sha256, hash(readFileSync(join(f.project, 'production.json'))));
  assert.equal(index.files.length, Object.keys(f.contents).length);
  assert.ok(index.files.some((x: { category: string }) => x.category === 'history'));
  const verified = run(f.project, 'verify-package', ['--archive', archive]);
  assert.equal(verified.status, 0, verified.stdout);
  assert.equal(verified.report.details.order.length, Object.keys(members).length);
});

test('输出路径不得覆盖制作成员或清单，失败保留原输入', t => {
  const f = fixture(); t.after(() => rmSync(f.project, { recursive: true, force: true }));
  for (const name of ['src.ts', 'production.json']) {
    const before = readFileSync(join(f.project, name));
    const result = run(f.project, 'pack', ['--output', name]);
    assert.equal(result.status, 1, result.stdout);
    assert.equal(result.report.status, 'failed');
    assert.deepEqual(readFileSync(join(f.project, name)), before);
  }
});

test('重复成员和清单自引用被拒绝，不覆盖已有有效交付包', t => {
  const f = fixture(); t.after(() => rmSync(f.project, { recursive: true, force: true }));
  assert.equal(run(f.project, 'pack').status, 0);
  const previous = readFileSync(join(f.project, 'delivery.tar.gz'));
  f.manifest.files.push({ ...f.manifest.files[0]! }); f.save();
  let result = run(f.project, 'pack');
  assert.equal(result.status, 1, result.stdout);
  assert.match(JSON.stringify(result.report), /重复/);
  assert.deepEqual(readFileSync(join(f.project, 'delivery.tar.gz')), previous);
  f.manifest.files.pop();
  f.manifest.files.push({ path: 'production.json', sha256: hash(readFileSync(join(f.project, 'production.json'))), category: 'production' }); f.save();
  result = run(f.project, 'pack');
  assert.equal(result.status, 1);
  assert.match(JSON.stringify(result.report), /清单自身|自引用/);
  assert.deepEqual(readFileSync(join(f.project, 'delivery.tar.gz')), previous);
});

for (const mode of ['missing', 'extra', 'duplicate', 'digest', 'manifest', 'gzip-crc', 'truncated', 'invalid-header', 'nonzero-tail', 'bad-header-at-end', 'missing-end-blocks', 'single-end-block']) {
  test(`真实归档拒绝 ${mode} 并保留完整失败报告与输入`, async t => {
    const f = fixture(); t.after(() => rmSync(f.project, { recursive: true, force: true }));
    assert.equal(run(f.project, 'pack').status, 0);
    const archive = join(f.project, 'delivery.tar.gz');
    if (['invalid-header', 'nonzero-tail', 'bad-header-at-end', 'missing-end-blocks', 'single-end-block'].includes(mode)) {
      corruptRawPackage(archive, mode);
    } else if (mode === 'gzip-crc') {
      const data = readFileSync(archive); data[data.length - 8]! ^= 255; writeFileSync(archive, data);
    } else if (mode === 'truncated') {
      const data = readFileSync(archive); writeFileSync(archive, data.subarray(0, data.length - 9));
    } else await rewrite(archive, mode);
    const result = run(f.project, 'verify-package', ['--archive', archive]);
    assert.equal(result.status, 1, result.stdout);
    assert.equal(result.report.status, 'failed');
    assert.ok(result.report.checks.some((x: { status: string }) => x.status === 'failed'));
    assert.ok(result.stdout.length < 1300);
    for (const [path, bytes] of Object.entries(f.contents)) assert.deepEqual(readFileSync(join(f.project, path)), Buffer.from(bytes));
  });
}

test('输入缺失或内容变化时不发布半成品，原有效包字节保持', t => {
  const f = fixture(); t.after(() => rmSync(f.project, { recursive: true, force: true }));
  assert.equal(run(f.project, 'pack').status, 0);
  const previous = readFileSync(join(f.project, 'delivery.tar.gz'));
  writeFileSync(join(f.project, 'src.ts'), 'changed');
  const changed = run(f.project, 'pack');
  assert.equal(changed.status, 1); assert.match(JSON.stringify(changed.report), /src.ts/);
  assert.deepEqual(readFileSync(join(f.project, 'delivery.tar.gz')), previous);
  rmSync(join(f.project, 'src.ts'));
  const missing = run(f.project, 'pack');
  assert.equal(missing.status, 1); assert.match(JSON.stringify(missing.report), /src.ts/);
  assert.deepEqual(readFileSync(join(f.project, 'delivery.tar.gz')), previous);
});

for (const mode of ['escape', 'absolute', 'empty', 'omitted-source', 'invalid-category']) {
  test(`清单 ${mode} 不能发布为完整制作交付包`, t => {
    const f = fixture(); t.after(() => rmSync(f.project, { recursive: true, force: true }));
    const outside = mkdtempSync(join(tmpdir(), 'clapgrid-outside-'));
    t.after(() => rmSync(outside, { recursive: true, force: true }));
    writeFileSync(join(outside, 'outside.txt'), 'outside');
    if (mode === 'escape') f.manifest.files.push({ path: '../' + outside.split('/').at(-1) + '/outside.txt', sha256: hash('outside'), category: 'production' });
    if (mode === 'absolute') f.manifest.files.push({ path: join(outside, 'outside.txt'), sha256: hash('outside'), category: 'production' });
    if (mode === 'empty') f.manifest.files.length = 0;
    if (mode === 'omitted-source') f.manifest.files = f.manifest.files.filter(x => x.path !== 'src.ts');
    if (mode === 'invalid-category') f.manifest.files[0]!.category = 'undecided';
    f.save();
    const result = run(f.project, 'pack');
    assert.equal(result.status, 1, result.stdout);
    assert.equal(result.report.status, 'failed');
    assert.equal(existsSync(join(f.project, 'delivery.tar.gz')), false);
  });
}

test('发布失败保留可定位候选与已有有效包，独立恢复后全部成员可再核对', async t => {
  const f = fixture(); t.after(() => rmSync(f.project, { recursive: true, force: true }));
  assert.equal(run(f.project, 'pack').status, 0);
  const archive = join(f.project, 'delivery.tar.gz');
  const previous = readFileSync(archive);
  mkdirSync(join(f.project, '拒绝发布'));
  const failed = run(f.project, 'pack', ['--output', '拒绝发布']);
  assert.equal(failed.status, 1);
  assert.match(JSON.stringify(failed.report), /候选包/);
  assert.ok(readdirSync(f.project).some(x => x.startsWith('.拒绝发布.candidate-')));
  assert.deepEqual(readFileSync(archive), previous);
  const restored = mkdtempSync(join(tmpdir(), 'clapgrid-restore-'));
  t.after(() => rmSync(restored, { recursive: true, force: true }));
  const restoredMembers = await restorePackage(archive, restored);
  for (const member of restoredMembers) assert.deepEqual(readFileSync(join(restored, member.header.name)), member.body);
  assert.deepEqual(readFileSync(join(restored, 'production.json')), readFileSync(join(f.project, 'production.json')));
  const verified = run(restored, 'verify-package', ['--archive', archive]);
  assert.equal(verified.status, 0, verified.stdout);
  for (const [path, data] of Object.entries(f.contents)) assert.deepEqual(readFileSync(join(restored, path)), Buffer.from(data));
});

test('清单不能使用工具索引保留名，原清单保持且不发布错误包', t => {
  const f = fixture(); t.after(() => rmSync(f.project, { recursive: true, force: true }));
  const original = readFileSync(join(f.project, 'production.json'));
  writeFileSync(join(f.project, '.clapgrid-package.json'), original);
  const result = run(f.project, 'pack', ['--manifest', '.clapgrid-package.json']);
  assert.equal(result.status, 1, result.stdout);
  assert.match(JSON.stringify(result.report), /保留/);
  assert.deepEqual(readFileSync(join(f.project, '.clapgrid-package.json')), original);
  assert.equal(existsSync(join(f.project, 'delivery.tar.gz')), false);
});

test('报告指向默认交付路径时提前拒绝，失败保留旧包并另存报告', t => {
  const f = fixture(); t.after(() => rmSync(f.project, { recursive: true, force: true }));
  assert.equal(run(f.project, 'pack').status, 0);
  const archive = join(f.project, 'delivery.tar.gz');
  const previous = readFileSync(archive);
  // 让本次候选与旧包不同，才能发现“退出失败但先发布”的问题。
  writeFileSync(join(f.project, 'src.ts'), 'export const scene = 2;');
  f.manifest.files.find(x => x.path === 'src.ts')!.sha256 = hash('export const scene = 2;'); f.save();
  const result = spawnSync(process.execPath, [cli, 'pack', '--project', f.project, '--report', archive], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stdout);
  assert.deepEqual(readFileSync(archive), previous);
  assert.match(result.stdout, /完整报告/);
  const logs = readdirSync(join(f.project, 'logs/production'));
  const report = JSON.parse(readFileSync(join(f.project, 'logs/production', logs[0]!), 'utf8'));
  assert.equal(report.status, 'failed');
});

for (const [field, declarations] of [
  ['assets', { assets: ['新增素材.png'] }],
  ['lastFrame', { lastFrame: '新增素材.png' }],
  ['transitions', { transitions: ['新增素材.png'] }],
  ['sample-video', { video: { path: '新增素材.png' }, plan: { path: '历史待审.json' } }],
  ['sample-plan', { video: { path: '审阅.mp4' }, plan: { path: '新增素材.png' } }],
] as const) {
  test(`打包必须保留已声明 ${field}，不能以依赖图缺省跳过`, t => {
    const f = fixture(); t.after(() => rmSync(f.project, { recursive: true, force: true }));
    const bytes = Buffer.from('归档成员字节，不声明为有效媒体');
    writeFileSync(join(f.project, '新增素材.png'), bytes);
    f.manifest.files.push({ path: '新增素材.png', sha256: hash(bytes), category: 'production' });
    if (field.startsWith('sample-')) Object.assign(f.manifest, { sample: declarations });
    else Object.assign(f.manifest.segments[0]!, declarations);
    f.save();
    assert.equal(run(f.project, 'pack').status, 0);
    const archive = join(f.project, 'delivery.tar.gz');
    const previous = readFileSync(archive);
    f.manifest.files = f.manifest.files.filter(x => x.path !== '新增素材.png'); f.save();
    const result = run(f.project, 'pack');
    assert.equal(result.status, 1, result.stdout);
    assert.match(JSON.stringify(result.report), /遗漏.*新增素材/);
    assert.deepEqual(readFileSync(archive), previous);
  });
}

for (const target of ['existing-directory', 'non-report-file', 'file-parent']) {
  test(`报告目标 ${target} 在发布前拒绝，旧有效包及报告原件保持`, t => {
    const f = fixture(); t.after(() => rmSync(f.project, { recursive: true, force: true }));
    assert.equal(run(f.project, 'pack').status, 0);
    const archive = join(f.project, 'delivery.tar.gz');
    const previous = readFileSync(archive);
    writeFileSync(join(f.project, 'src.ts'), 'export const scene = 3;');
    f.manifest.files.find(x => x.path === 'src.ts')!.sha256 = hash('export const scene = 3;'); f.save();
    const targetPath = join(f.project, '报告目标');
    if (target === 'existing-directory') mkdirSync(targetPath);
    else writeFileSync(targetPath, '这不是制作报告');
    const requested = target === 'file-parent' ? join(targetPath, '报告.json') : targetPath;
    const result = spawnSync(process.execPath, [cli, 'pack', '--project', f.project, '--report', requested], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stdout);
    assert.deepEqual(readFileSync(archive), previous);
    if (target !== 'existing-directory') assert.equal(readFileSync(targetPath, 'utf8'), '这不是制作报告');
    assert.match(result.stdout, /完整报告/);
    const logs = readdirSync(join(f.project, 'logs/production'));
    const report = JSON.parse(readFileSync(join(f.project, 'logs/production', logs[0]!), 'utf8'));
    assert.equal(report.status, 'failed');
  });
}

for (const field of ['assets', 'lastFrame', 'transitions']) {
  test(`声明的 ${field} 即使是旧报告JSON也不能被新报告覆盖`, t => {
    const f = fixture(); t.after(() => rmSync(f.project, { recursive: true, force: true }));
    const artifact = join(f.project, '关联技术原件.json');
    const bytes = JSON.stringify({ schemaVersion: 1, report: artifact, startedAt: '2026-10-13T00:00:00Z', checks: [] });
    writeFileSync(artifact, bytes);
    Object.assign(f.manifest.segments[0]!, { [field]: field === 'lastFrame' ? '关联技术原件.json' : ['关联技术原件.json'] }); f.save();
    const result = spawnSync(process.execPath, [cli, 'impact', '--project', f.project, '--report', artifact], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(readFileSync(artifact, 'utf8'), bytes);
    assert.match(result.stdout, /拒绝覆盖/);
  });
}

for (const omitted of ['当前技术产物.json', '当前证明原件.json']) {
  test(`当前审阅引用的 ${omitted} 必须入包，独立恢复后证据仍可核对`, async t => {
    const f = fixture(); t.after(() => rmSync(f.project, { recursive: true, force: true }));
    const artifact = '当前技术产物.json'; const proof = '当前证明原件.json';
    const data = '隔离归档及证据机械核对产物';
    const evidence = { schemaVersion: 1, reviewVersion: 'current-review',
      requirements: [{ id: 'R', classifiedBy: { source: 'human', identity: '隔离受控回归配置' }, required: [{ id: 'mechanical', kind: 'ran', artifact, scope: ['A'] }] }],
      records: [{ id: 'E', requirement: 'R', criterion: 'mechanical', kind: 'ran', reviewVersion: 'current-review', artifact: { path: artifact, sha256: hash(data) }, scope: ['A'], status: 'passed', source: 'controlled-test', provenance: { actor: '受控测试', record: omitted === '当前证明原件.json' ? pathToFileURL(join(f.project, proof)).href : proof, observedAt: '2026-10-13T00:00:00Z' } }],
    };
    for (const [path, bytes] of [[artifact, data], [proof, '受控测试原件，不是真实用户/宿主确认'], ['证据.json', JSON.stringify(evidence)]]) {
      writeFileSync(join(f.project, path!), bytes!);
      f.manifest.files.push({ path: path!, sha256: hash(bytes!), category: 'technical' });
    }
    Object.assign(f.manifest, { evidence: '证据.json' }); f.save();
    const originalEvidence = run(f.project, 'evidence');
    assert.equal(originalEvidence.status, 0);
    assert.equal(run(f.project, 'pack').status, 0);
    const archive = join(f.project, 'delivery.tar.gz'); const previous = readFileSync(archive);
    f.manifest.files = f.manifest.files.filter(x => x.path !== omitted); f.save();
    const failed = run(f.project, 'pack');
    assert.equal(failed.status, 1, failed.stdout);
    assert.match(JSON.stringify(failed.report), /遗漏/);
    assert.deepEqual(readFileSync(archive), previous);
    const restored = mkdtempSync(join(tmpdir(), 'clapgrid-proof-restore-')); t.after(() => rmSync(restored, { recursive: true, force: true }));
    const restoredMembers = await restorePackage(archive, restored);
    for (const member of restoredMembers) assert.deepEqual(readFileSync(join(restored, member.header.name)), member.body);
    assert.equal(readFileSync(join(restored, '证据.json'), 'utf8'), JSON.stringify(evidence));
    assert.equal(readFileSync(join(restored, proof), 'utf8'), '受控测试原件，不是真实用户/宿主确认');
    const verified = run(restored, 'verify-package', ['--archive', archive]);
    assert.equal(verified.status, 0, verified.stdout);
    const restoredEvidence = run(restored, 'evidence');
    assert.equal(restoredEvidence.report.details.requirements[0].writeBackAllowed, false);
    assert.deepEqual(restoredEvidence.report.details.requirements, originalEvidence.report.details.requirements);
    assert.equal(run(restored, 'evidence').status, 0);
  });
}

test('打包保留待审及历史记录，不强求尚未生成或历史失效的原件', async t => {
  const f = fixture(); t.after(() => rmSync(f.project, { recursive: true, force: true }));
  const evidence = { schemaVersion: 1, reviewVersion: 'current', requirements: [{ id: 'future', required: [{ id: 'pending', artifact: '未制作样片.mp4' }] }],
    records: [{ reviewVersion: 'old', artifact: { path: '旧版已失效.mp4' }, provenance: { record: '旧版记录.txt' } }, { reviewVersion: 'current', provenance: { record: 'https://example.invalid/user-review' } }] };
  const bytes = JSON.stringify(evidence); writeFileSync(join(f.project, '待审历史.json'), bytes);
  f.manifest.files.push({ path: '待审历史.json', sha256: hash(bytes), category: 'history' }); Object.assign(f.manifest, { evidence: '待审历史.json' }); f.save();
  const result = run(f.project, 'pack'); assert.equal(result.status, 0, result.stdout);
  assert.equal((await inspect(join(f.project, 'delivery.tar.gz')))['待审历史.json'], Buffer.from(bytes).toString('base64'));
});
