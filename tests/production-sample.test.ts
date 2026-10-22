import { test, type ResourceFixtures } from './helpers/resource-test.js';
import assert from 'node:assert/strict';
import { vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

type Resources = Pick<ResourceFixtures, 'command' | 'createDirectory'>;

const entry = fileURLToPath(new URL('../scripts/production.mjs', import.meta.url));
type RecordEntry = { id: string; requirement: string; criterion: string; kind: string; reviewVersion: string; artifact: { path: string; sha256: string }; scope: string[]; status: string; source: string;
  provenance: { actor: string; record: string; observedAt: string }; reuseOf?: string };
async function fixture(t: Pick<Resources, 'command' | 'createDirectory'>) {
  const project = t.createDirectory(join(tmpdir(), '样片 中文 项目 '));
  const media = (await t.command('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=64x48:r=10:d=0.3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(project, '动态样片.mp4')], { encoding: 'utf8' }));
  assert.equal(media.status, 0, media.stderr);
  writeFileSync(join(project, '模拟确认原件.txt'), '隔离模拟机制测试；没有实际用户看过或批准项目，不构成实际制作许可。\n');
  writeFileSync(join(project, '视觉方案.json'), '{"整体观感":"简洁图形","关键做法":"对象移动保持标签与身份"}\n');
  const asset = (path: string) => ({ path, sha256: createHash('sha256').update(readFileSync(join(project, path))).digest('hex') });
  const scope = ['visual:materials', 'visual:motion', 'visual:transition'];
  const sample = { id: 'sample-1', mode: 'controlled-test', reviewVersion: 'direction-1', video: asset('动态样片.mp4'), plan: asset('视觉方案.json'), scope,
    representative: { materials: ['A'], motions: ['A-move'], transitions: ['A-to-B'] }, confirmation: { requirement: 'direction', videoCriterion: 'video', planCriterion: 'plan' } };
  const evidence = { schemaVersion: 1, reviewVersion: 'direction-1', requirements: [{ id: 'direction', text: '样片所示视觉方向确认', classifiedBy: { source: 'human', identity: '受控测试作者' },
    required: [{ id: 'video', kind: 'user', artifact: sample.video.path, scope }, { id: 'plan', kind: 'user', artifact: sample.plan.path, scope }] }], records: [] as RecordEntry[] };
  const save = () => {
    writeFileSync(join(project, 'production.json'), JSON.stringify({ schemaVersion: 1, project: { width: 64, height: 48, fps: 10 }, typecheck: 'tsconfig.json',
      segments: [{ id: 'A', card: 'card.json', source: 'source.ts', audio: 'audio.wav', frames: 3, assembly: 'assembly.mp4', review: 'review.mp4' }], evidence: '审阅.json', sample }));
    writeFileSync(join(project, '审阅.json'), JSON.stringify(evidence));
  };
  const confirm = (source = 'controlled-test', status = 'passed') => {
    evidence.records = [['video', sample.video], ['plan', sample.plan]].map(([criterion, artifact]) => ({ id: `${criterion}-1`, requirement: 'direction', criterion: criterion as string, kind: 'user', reviewVersion: 'direction-1', artifact: artifact as { path: string; sha256: string }, scope: [...scope], status, source,
      provenance: { actor: '受控模拟声明者（非实际用户确认）', record: '模拟确认原件.txt', observedAt: '2026-10-13T00:00:00Z' } }));
  };
  const run = async () => {
    const originals = ['审阅.json', '模拟确认原件.txt'].map(path => readFileSync(join(project, path)));
    const result = (await t.command(process.execPath, [entry, 'sample', '--project', project, '--report', join(project, '结果.json')], { encoding: 'utf8' }));
    assert.deepEqual(['审阅.json', '模拟确认原件.txt'].map(path => readFileSync(join(project, path))), originals);
    return { ...result, report: JSON.parse(readFileSync(join(project, '结果.json'), 'utf8')) };
  };
  save();
  return { project, sample, evidence, confirm, save, run, asset };
}

test('真实动态样片与视觉方案未取得用户确认时禁止批量并保留终审边界', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = (await fixture(t)); const result = (await f.run());
  assert.equal(result.status, 1);
  assert.equal(result.report.status, 'pending', result.stdout);
  assert.equal(result.report.details.batchAllowed, false);
  assert.deepEqual(result.report.details.excluded, ['其他画面', '领域准确性', '发音听审', '完整成片终审']);
});

test('隔离模拟机制测试：实际项目模式配合模拟用户确认可取得程序许可，不代表实际用户确认或制作许可', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = (await fixture(t)); f.sample.mode = 'actual-project'; f.confirm('user-confirmation'); f.save();
  const result = (await f.run());
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.report.status, 'passed');
  assert.equal(result.report.details.mechanicalEvidenceComplete, true);
  assert.equal(result.report.details.batchAllowed, true);
  assert.deepEqual(result.report.details.excluded, ['其他画面', '领域准确性', '发音听审', '完整成片终审']);
});

test('隔离模拟机制测试：受控确认完整时只演练机制，即使模拟真实来源也不授予实际批量许可', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = (await fixture(t));
  for (const source of ['controlled-test', 'user-confirmation']) {
    f.confirm(source); f.save();
    const result = (await f.run());
    assert.equal(result.status, 1, result.stdout);
    assert.equal(result.report.status, 'pending');
    assert.equal(result.report.details.mechanicalEvidenceComplete, true);
    assert.equal(result.report.details.batchAllowed, false);
    assert.equal(result.report.details.confirmations.length, 2);
  }
  });

test('隔离模拟机制测试：实际项目模式配合受控来源独立阻止批量许可', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = (await fixture(t)); f.sample.mode = 'actual-project'; f.confirm(); f.save();
  const result = (await f.run());
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.report.status, 'pending');
  assert.equal(result.report.details.mechanicalEvidenceComplete, true);
  assert.equal(result.report.details.batchAllowed, false);
});

test('隔离模拟机制测试：方案和范围不变可复用样片确认，普通文档备注不使产物确认失效', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = (await fixture(t)); f.sample.mode = 'actual-project'; f.confirm('user-confirmation');
  const originals = f.evidence.records;
  f.sample.reviewVersion = f.evidence.reviewVersion = 'direction-2';
  f.evidence.records = [...originals, ...originals.map(record => ({ ...record, id: `${record.id}-reuse`, reviewVersion: 'direction-2', reuseOf: record.id }))];
  f.save();
  writeFileSync(join(f.project, 'video.md'), '普通制作备注更新，不改视觉方案。');
  const result = (await f.run());
  assert.equal(result.report.details.mechanicalEvidenceComplete, true, result.stdout);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.report.status, 'passed');
  assert.equal(result.report.details.batchAllowed, true);
  assert.deepEqual(result.report.details.confirmations.map((item: { reusedFrom: string[] }) => item.reusedFrom), [['video-1'], ['plan-1']]);
  assert.deepEqual(result.report.details.confirmations.map((item: { provenance: unknown }) => item.provenance), originals.map(item => item.provenance));
});

for (const scenario of ['否决', '错误版本', '样片版本变化', '方案变化', '样片变化', '范围变化', '其他确认来源', '声明者变化', '确认时间变化', '技术证据替代用户', '范围越界', '损坏视频']) test(`隔离模拟机制测试：真实样片入口在${scenario}时保持未允许批量`, async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = (await fixture(t)); f.sample.mode = 'actual-project'; f.confirm('user-confirmation');
  if (scenario === '否决') f.evidence.records[0]!.status = 'denied';
  if (scenario === '错误版本') f.evidence.reviewVersion = 'other-review';
  if (scenario === '样片版本变化') f.sample.reviewVersion = 'other-sample-review';
  if (scenario === '样片变化') {
    const encode = (await command('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=64x48:r=10:d=0.6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(f.project, f.sample.video.path)], { encoding: 'utf8' }));
    assert.equal(encode.status, 0, encode.stderr); f.sample.video = f.asset(f.sample.video.path);
  }
  if (scenario === '方案变化') { writeFileSync(join(f.project, f.sample.plan.path), '{"整体观感":"新方案"}'); f.sample.plan = f.asset(f.sample.plan.path); }
  if (scenario === '范围变化') f.sample.scope = [...f.sample.scope, 'visual:new-boundary'];
  if (scenario === '声明者变化') f.evidence.records[1]!.provenance.actor = '另一隔离模拟声明者';
  if (scenario === '确认时间变化') f.evidence.records[1]!.provenance.observedAt = '2026-10-14T00:00:00Z';
  if (scenario === '其他确认来源') f.evidence.records[1]!.provenance.record = '另一份受控模拟用户发言';
  if (scenario === '技术证据替代用户') { for (const criterion of f.evidence.requirements[0]!.required) criterion.kind = 'ran'; for (const record of f.evidence.records) record.kind = 'ran'; }
  if (scenario === '范围越界') f.sample.scope = ['domain:accuracy'];
  if (scenario === '损坏视频') { writeFileSync(join(f.project, f.sample.video.path), '损坏媒体'); f.sample.video = f.asset(f.sample.video.path); }
  f.save();
  const before = readFileSync(join(f.project, '审阅.json'));
  const result = (await f.run());
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.report.status, 'failed');
  assert.equal(result.report.details.batchAllowed, false);
  assert.deepEqual(readFileSync(join(f.project, '审阅.json')), before);
});

test('隔离模拟机制测试：其它终审要求待审时所选视觉范围仍可许可，保留终审排除范围', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = (await fixture(t)); f.sample.mode = 'actual-project'; f.confirm('user-confirmation');
  f.evidence.requirements.push({ id: 'final-film', text: '完整成片终审', classifiedBy: { source: 'human', identity: '受控测试作者' }, required: [{ id: 'final', kind: 'user', artifact: '未制作全片.mp4', scope: ['final-film'] }] });
  f.save();
  const result = (await f.run());
  assert.equal(result.report.details.mechanicalEvidenceComplete, true, result.stdout);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.report.status, 'passed');
  assert.equal(result.report.details.batchAllowed, true);
  assert.deepEqual(result.report.details.excluded, ['其他画面', '领域准确性', '发音听审', '完整成片终审']);
  assert.ok(result.report.checks.every((check: { id: string }) => !check.id.startsWith('final-film:')));
});

test('隔离模拟机制测试：局部损坏的视频即使工具宽容退出零也不能冒记完整解码通过', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = (await fixture(t)); f.sample.mode = 'actual-project';
  const path = join(f.project, f.sample.video.path);
  const encode = (await command('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=64x48:r=10:d=1', '-c:v', 'libx264', '-g', '10', '-bf', '0', '-pix_fmt', 'yuv420p', path], { encoding: 'utf8' }));
  assert.equal(encode.status, 0, encode.stderr);
  const packets = (await command('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_packets', '-show_entries', 'packet=pos,size', '-of', 'json', path], { encoding: 'utf8' }));
  assert.equal(packets.status, 0, packets.stderr);
  const packet = JSON.parse(packets.stdout).packets[4];
  const bytes = readFileSync(path);
  bytes.fill(0, Number(packet.pos), Number(packet.pos) + Number(packet.size));
  writeFileSync(path, bytes);
  const tolerant = (await command('ffmpeg', ['-v', 'error', '-nostdin', '-i', path, '-map', '0:v:0', '-f', 'null', '-'], { encoding: 'utf8' }));
  assert.equal(tolerant.status, 0, tolerant.stderr);
  assert.notEqual(tolerant.stderr.trim(), '', '宽容解码退出零仍报告损坏，不能视为完整解码无错');
  f.sample.video = f.asset(f.sample.video.path); f.confirm('user-confirmation'); f.save();
  const before = readFileSync(join(f.project, '审阅.json'));
  const result = (await f.run());
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.report.status, 'failed');
  assert.equal(result.report.details.batchAllowed, false);
  assert.notEqual(result.report.details.mechanicalEvidenceComplete, true);
  assert.ok(!result.report.checks.some((check: { id: string; status: string }) => check.id === 'sample-video' && check.status === 'passed'));
  assert.deepEqual(readFileSync(join(f.project, '审阅.json')), before);
});

test('隔离模拟机制测试：含冒号身份碰撞仍定位所选视觉方向，不代表实际用户确认或制作许可', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = (await fixture(t)); f.sample.mode = 'actual-project'; f.confirm('user-confirmation');
  f.sample.confirmation.requirement = 'direction:visual';
  f.evidence.requirements[0]!.id = 'direction:visual';
  for (const record of f.evidence.records) record.requirement = 'direction:visual';
  f.evidence.requirements.push({ id: 'direction', text: '隔离模拟另一合法身份', classifiedBy: { source: 'human', identity: '隔离模拟作者' }, required: [{ id: 'visual:video', kind: 'user', artifact: f.sample.video.path, scope: [...f.sample.scope] }] });
  f.evidence.records.push({ ...f.evidence.records[0]!, id: 'simulated-other-identity', requirement: 'direction', criterion: 'visual:video' });
  f.save();
  const result = (await f.run());
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.report.status, 'passed');
  assert.equal(result.report.details.batchAllowed, true);
  assert.deepEqual(result.report.details.confirmations.map((item: { evidenceId: string }) => item.evidenceId), ['video-1', 'plan-1']);
  assert.ok(result.report.checks.some((check: { id: string }) => check.id === 'direction:visual:video'));
});

for (const media of ['静态图片', '单帧视频']) test(`隔离模拟机制测试：${media}不能取得批量许可`, async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = (await fixture(t)); f.sample.mode = 'actual-project';
  const path = media === '静态图片' ? '静态图片.png' : f.sample.video.path;
  const encode = (await command('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=64x48:r=10', '-frames:v', '1', join(f.project, path)], { encoding: 'utf8' }));
  assert.equal(encode.status, 0, encode.stderr);
  f.sample.video = f.asset(path); f.confirm('user-confirmation'); f.save();
  const result = (await f.run());
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.report.status, 'failed');
  assert.equal(result.report.details.batchAllowed, false);
  assert.ok(!result.report.checks.some((check: { id: string; status: string }) => check.id === 'sample-video' && check.status === 'passed'));
});
