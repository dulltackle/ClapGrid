import { test, type ResourceFixtures } from './helpers/resource-test.js';
import assert from 'node:assert/strict';
import { vi } from 'vitest';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

type Resources = Pick<ResourceFixtures, 'command' | 'createDirectory'>;

const entry = fileURLToPath(new URL('../scripts/production.mjs', import.meta.url));
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
async function ffmpeg(t: Pick<Resources, 'command'>, args: string[]) {
  const result = (await t.command('ffmpeg', ['-v', 'error', '-nostdin', '-y', ...args], { encoding: 'utf8' }));
  assert.equal(result.status, 0, result.stderr);
}
async function frame(t: Pick<Resources, 'command'>, path: string, index: number) {
  const result = (await t.command('ffmpeg', ['-v', 'error', '-nostdin', '-i', path, '-vf', `select=eq(n\\,${index})`, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1024 * 1024, encoding: 'latin1' }));
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(result.stdout.length, 64 * 48 * 3);
  const center = (24 * 64 + 32) * 3;
  return [...Buffer.from(result.stdout, 'latin1').subarray(center, center + 3)];
}
type Node = { id: string; path: string; kind: string; segmentId?: string; sha256: string; dependsOn: string[] };
async function fixture(t: Pick<Resources, 'command' | 'createDirectory'>) {
  const project = t.createDirectory(join(tmpdir(), '真实依赖 中文 项目 '));
  writeFileSync(join(project, 'video.md'), '本项目只用于受控技术回归，不是用户视觉确认。\n');
  (await ffmpeg(t, ['-f', 'lavfi', '-i', 'color=c=white:s=8x8', '-frames:v', '1', '-update', '1', join(project, '共享素材.png')]));
  const segments = ['A', 'B', 'C'].map(id => ({ id, source: `${id}-source.mjs`, card: `${id}-card.json`, audio: `${id}-audio.wav`, frames: 6, assembly: `${id}-assembly.mkv`, review: `${id}-review.mkv`, assets: id !== 'C' ? ['共享素材.png'] : [], lastFrame: id === 'A' ? 'A-last-frame.png' : undefined, transitions: id === 'B' ? ['B-transition.mkv'] : [] }));
  writeFileSync(join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { allowJs: true, checkJs: true, types: [], noEmit: true }, files: segments.map(s => s.source) }));
  const colorOf = async (id: string) => {
    const card = JSON.parse(readFileSync(join(project, `${id}-card.json`), 'utf8'));
    const result = (await t.command(process.execPath, ['--input-type=module', '-e', 'const module = await import(process.argv[1]); process.stdout.write(module.color);', pathToFileURL(join(project, card.segments[0].source)).href], { encoding: 'utf8' }));
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const render = async (id: string) => {
    const color = (await colorOf(id));
    if (id === 'B') {
      (await ffmpeg(t, ['-loop', '1', '-framerate', '10', '-i', join(project, 'A-last-frame.png'), '-frames:v', '2', '-c:v', 'ffv1', join(project, 'B-transition.mkv')]));
      (await ffmpeg(t, ['-i', join(project, 'B-transition.mkv'), '-f', 'lavfi', '-i', `color=c=${color}:s=64x48:r=10:d=0.4`, '-i', join(project, '共享素材.png'), '-filter_complex', '[0:v]setpts=PTS-STARTPTS[start];[1:v][2:v]overlay=x=0:y=0[painted];[painted]setpts=PTS-STARTPTS[body];[start][body]concat=n=2:v=1:a=0[out]', '-map', '[out]', '-frames:v', '6', '-c:v', 'ffv1', join(project, 'B-assembly.mkv')]));
    } else {
      (await ffmpeg(t, ['-f', 'lavfi', '-i', `color=c=${color}:s=64x48:r=10:d=0.6`, ...(id === 'A' ? ['-i', join(project, '共享素材.png'), '-filter_complex', '[0:v][1:v]overlay=x=0:y=0[out]', '-map', '[out]'] : []), '-frames:v', '6', '-c:v', 'ffv1', join(project, `${id}-assembly.mkv`)]));
    }
    (await ffmpeg(t, ['-i', join(project, `${id}-assembly.mkv`), '-i', join(project, `${id}-audio.wav`), '-c', 'copy', join(project, `${id}-review.mkv`)]));
    if (id === 'A') (await ffmpeg(t, ['-i', join(project, 'A-assembly.mkv'), '-vf', 'select=eq(n\\,5)', '-frames:v', '1', '-update', '1', join(project, 'A-last-frame.png')]));
  };
  for (const [index, segment] of segments.entries()) {
    writeFileSync(join(project, segment.source), `export const color = ${JSON.stringify(['red', 'green', 'purple'][index])};\n`);
    writeFileSync(join(project, segment.card), JSON.stringify({ segments: [{ id: segment.id, source: segment.source, audio: segment.audio }] }));
    (await ffmpeg(t, ['-f', 'lavfi', '-i', `sine=frequency=${440 + index * 110}:duration=0.6:sample_rate=16000`, join(project, segment.audio)]));
    (await render(segment.id));
  }
  const nodes: Node[] = [];
  const add = (id: string, path: string, kind: string, dependsOn: string[] = [], segmentId?: string) => nodes.push({ id, path, kind, dependsOn, segmentId, sha256: sha(join(project, path)) });
  add('shared', '共享素材.png', 'asset');
  for (const s of segments) {
    add(`${s.id}-source`, s.source, 'source', [], s.id);
    add(`${s.id}-card`, s.card, 'card', [], s.id);
    add(`${s.id}-audio`, s.audio, 'audio', [], s.id);
    add(`${s.id}-assembly`, s.assembly, 'assembly', [`${s.id}-source`, `${s.id}-card`, ...(s.id !== 'C' ? ['shared'] : []), ...(s.id === 'B' ? ['B-transition'] : [])], s.id);
    add(`${s.id}-review`, s.review, 'review', [`${s.id}-assembly`, `${s.id}-audio`], s.id);
  }
  add('A-last-frame', 'A-last-frame.png', 'last-frame', ['A-assembly'], 'A');
  add('B-transition', 'B-transition.mkv', 'transition', ['A-last-frame'], 'B');
  const manifest = { schemaVersion: 1, project: { width: 64, height: 48, fps: 10 }, typecheck: 'tsconfig.json', segments, evidence: undefined as string | undefined, dependencies: { complete: true, nodes, renderInputs: { width: 64, height: 48, fps: 10, segments: segments.map(s => ({ id: s.id, frames: s.frames })) } as { width: number; height: number; fps: number; segments: { id: string; frames: number }[] } | undefined } };
  const save = () => writeFileSync(join(project, 'production.json'), JSON.stringify(manifest));
  save();
  const run = async (command = 'impact') => {
    const result = (await t.command(process.execPath, [entry, command, '--project', project, '--report', join(project, `${command}-report.json`)], { encoding: 'utf8' }));
    const path = result.stdout.match(/完整报告：(.+)\n/)?.[1];
    assert.ok(path, result.stderr + result.stdout);
    return { ...result, report: JSON.parse(readFileSync(path, 'utf8')) };
  };
  return { project, nodes, segments, manifest, save, run, render };
}

test('真实入口只读核对完整稳定依赖图，未变媒体可复用而不声明实际配音或宿主通过', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = (await fixture(t));
  const before = readFileSync(join(f.project, 'production.json'));
  const result = (await f.run());
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.report.status, 'passed');
  assert.deepEqual(result.report.affected.outputs, []);
  assert.equal(result.report.details.unchanged.length, 18);
  assert.equal(result.report.details.actualHost, 'pending');
  assert.equal(result.report.details.evidence.status, 'pending');
  assert.deepEqual(result.report.details.evidence.checks, []);
  assert.deepEqual(result.report.details.evidence.needsReview, []);
  assert.deepEqual(readFileSync(join(f.project, 'production.json')), before);
});

test('A源改变使A末帧和B相邻转场重制，真实边界消除旧画面并保留C与配音', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = (await fixture(t));
  const retained = f.nodes.filter(n => n.segmentId === 'C' || n.kind === 'audio').map(n => ({ path: n.path, sha256: sha(join(f.project, n.path)) }));
  const oldBorder = (await frame(t, join(f.project, 'B-assembly.mkv'), 0));
  assert.ok(oldBorder[0]! > 240 && oldBorder[2]! < 10, `旧边界应为红色：${oldBorder}`);
  writeFileSync(join(f.project, 'A-source.mjs'), 'export const color = "blue";\n');
  const before = readFileSync(join(f.project, 'production.json'));
  const result = (await f.run());
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.report.status, 'pending');
  assert.deepEqual(result.report.affected.outputs.map((n: { id: string }) => n.id).sort(), ['A-assembly', 'A-last-frame', 'A-review', 'B-assembly', 'B-review', 'B-transition'].sort());
  assert.equal(result.report.affected.outputs.find((n: { id: string }) => n.id === 'A-assembly').relation, 'direct');
  const transition = result.report.affected.outputs.find((n: { id: string }) => n.id === 'B-transition');
  assert.equal(transition.relation, 'indirect');
  assert.ok(transition.reasonChains.some((chain: string[]) => chain.join(' -> ') === 'A-source -> A-assembly -> A-last-frame -> B-transition'));
  assert.deepEqual(result.report.affected.segments, ['A', 'B']);
  assert.deepEqual(readFileSync(join(f.project, 'production.json')), before);
  // 按实际源重制A，再抽A真实末帧制作B，不把预期蓝色直接写入B。
  (await f.render('A')); (await f.render('B'));
  for (const [path, index] of [['A-assembly.mkv', 0], ['A-assembly.mkv', 5], ['B-transition.mkv', 0], ['B-assembly.mkv', 0], ['B-assembly.mkv', 1]] as const) {
    const pixel = (await frame(t, join(f.project, path), index));
    assert.ok(pixel[2]! > 240 && pixel[0]! < 10, `${path}:${index}应为新蓝色，旧红色已消失：${pixel}`);
  }
  const next = (await frame(t, join(f.project, 'B-assembly.mkv'), 2));
  assert.ok(next[1]! > 100 && next[0]! < 10 && next[2]! < 10, `转场相邻后帧应为B绿色：${next}`);
  retained.forEach(item => assert.equal(sha(join(f.project, item.path)), item.sha256));
  const checked = (await f.run('check'));
  assert.equal(checked.status, 0, checked.stdout);
});

test('完整标记不能掩盖已知制作源到装配输出的漏接依赖', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = (await fixture(t));
  f.nodes.find(n => n.id === 'A-assembly')!.dependsOn = ['A-card', 'shared'];
  f.save();
  writeFileSync(join(f.project, 'A-source.mjs'), 'export const color = "blue";\n');
  const result = (await f.run());
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.report.status, 'failed');
  assert.match(result.report.checks[0].message, /A-assembly.*A-source|A-source.*A-assembly/);
  assert.equal(result.report.affected.complete, false);
});

test('尺寸配置改变而节点文件摘要未变时扩大全部输出核对', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = (await fixture(t));
  f.manifest.project.width = 128; f.save();
  const result = (await f.run());
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.report.status, 'pending');
  assert.deepEqual(result.report.affected.segments, ['A', 'B', 'C']);
  assert.equal(result.report.affected.outputs.length, 8);
  assert.ok(result.report.details.configurationChanges.some((c: { id: string }) => c.id === 'render:project'));
  assert.ok(result.report.details.unchanged.every((n: { kind: string }) => !['assembly', 'review', 'last-frame', 'transition'].includes(n.kind)));
});

test('影响识别重新核对旧确认，重制后真实证据入口拒绝旧A/B并复用未变C及配音', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = (await fixture(t));
  const requirements = [];
  const records = [];
  writeFileSync(join(f.project, '证明原件.txt'), '隔离机制测试模拟证明，不是真实用户审阅。\n');
  writeFileSync(join(f.project, '历史档案.json'), '{"original":"应保持原字节的模拟历史档案"}\n');
  const originals = ['证明原件.txt', '历史档案.json'].map(path => ({ path, bytes: readFileSync(join(f.project, path)) }));
  for (const node of f.nodes.filter(n => n.kind === 'review' || n.kind === 'audio')) {
    const scope = [node.segmentId!];
    const kind = node.kind === 'review' ? 'user' : 'ran';
    requirements.push({ id: node.id, classifiedBy: { source: 'human', identity: '受控技术测试作者' }, required: [{ id: 'proof', kind, artifact: node.path, scope }] });
    const record = { id: `old-${node.id}`, requirement: node.id, criterion: 'proof', kind, reviewVersion: 'version-1', artifact: { path: node.path, sha256: node.sha256 }, scope, status: 'passed', source: 'controlled-test', provenance: { actor: '受控测试', record: '证明原件.txt', observedAt: '2026-10-13T00:00:00Z' } };
    records.push(record, { ...record, id: `current-${node.id}`, reviewVersion: 'version-2', reuseOf: record.id });
  }
  f.manifest.evidence = '证据.json'; f.save();
  writeFileSync(join(f.project, '证据.json'), JSON.stringify({ schemaVersion: 1, reviewVersion: 'version-2', requirements, records }));
  assert.equal((await f.run('evidence')).status, 0);
  const proofBefore = readFileSync(join(f.project, '证据.json'));
  const unchangedOutput = sha(join(f.project, 'A-review.mkv'));
  writeFileSync(join(f.project, 'A-source.mjs'), 'export const color = "blue";\n');
  const impact = (await f.run());
  assert.equal(sha(join(f.project, 'A-review.mkv')), unchangedOutput);
  assert.equal(impact.status, 1, impact.stdout);
  assert.deepEqual(impact.report.details.evidence.needsReview.sort(), ['current-A-review', 'current-B-review']);
  assert.equal(impact.report.details.evidence.checks.find((c: { id: string }) => c.id === 'C-review:proof').status, 'passed');
  assert.deepEqual(impact.report.details.evidence.unchangedProofs.map((proof: { evidenceId: string }) => proof.evidenceId).sort(), ['current-A-audio', 'current-B-audio', 'current-C-audio', 'current-C-review']);
  const affectedA = impact.report.details.evidence.checks.find((c: { id: string }) => c.id === 'A-review:proof');
  assert.equal(affectedA.previousStatus, 'passed');
  assert.equal(affectedA.dependencyAffected, true);
  assert.equal(affectedA.status, 'pending');
  assert.deepEqual(affectedA.reusedFrom, ['old-A-review']);
  assert.deepEqual(affectedA.provenance, records.find(record => record.id === 'current-A-review')!.provenance);
  (await f.render('A')); (await f.render('B'));
  const evidence = (await f.run('evidence'));
  assert.equal(evidence.status, 1, evidence.stdout);
  for (const id of ['A-review', 'B-review']) assert.equal(evidence.report.checks.find((c: { id: string }) => c.id === `${id}:proof`).status, 'failed');
  for (const id of ['C-review', 'A-audio', 'B-audio', 'C-audio']) {
    const check = evidence.report.checks.find((c: { id: string }) => c.id === `${id}:proof`);
    assert.equal(check.status, 'passed');
    assert.deepEqual(check.reusedFrom, [`old-${id}`]);
    assert.equal(check.source, 'controlled-test');
  }
  assert.deepEqual(readFileSync(join(f.project, '证据.json')), proofBefore);
  for (const original of originals) assert.deepEqual(readFileSync(join(f.project, original.path)), original.bytes);
});

test('删除声明使用的转场节点及其边也不能把不完整图报告为无影响', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = (await fixture(t));
  f.nodes.splice(f.nodes.findIndex(n => n.id === 'B-transition'), 1);
  f.nodes.find(n => n.id === 'B-assembly')!.dependsOn = ['B-source', 'B-card', 'shared'];
  f.save();
  const result = (await f.run());
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.report.status, 'failed');
  assert.match(result.report.checks[0].message, /B-transition/);
});

type Fixture = Awaited<ReturnType<typeof fixture>>;
const invalid: { name: string; change: (f: Fixture) => void }[] = [
  { name: '完整性未确认', change: f => { f.manifest.dependencies.complete = false; } },
  { name: '未登记依赖身份', change: f => { f.nodes.find(n => n.id === 'B-transition')!.dependsOn = ['missing-frame']; } },
  { name: '稳定节点身份重复', change: f => { f.nodes.push({ ...f.nodes[0]! }); } },
  { name: '同一真实文件重复登记', change: f => { f.nodes.push({ ...f.nodes[0]!, id: 'another-shared' }); } },
  { name: '间接依赖循环', change: f => { f.nodes.find(n => n.id === 'A-source')!.dependsOn = ['B-review']; } },
  { name: '实际依赖文件缺失', change: f => { rmSync(join(f.project, 'A-last-frame.png')); } },
  { name: '配音未关联审阅输出', change: f => { f.nodes.find(n => n.id === 'A-review')!.dependsOn = ['A-assembly']; } },
  { name: '已声明共享素材未关联输出', change: f => { f.nodes.find(n => n.id === 'C-assembly')!.dependsOn = ['C-source']; f.segments[2]!.assets = ['共享素材.png']; } },
  { name: '节点使用未知片段身份', change: f => { f.nodes.find(n => n.id === 'A-assembly')!.segmentId = 'unknown-segment'; } },
  { name: '渲染基线身份重复', change: f => { f.manifest.dependencies.renderInputs!.segments.push({ id: 'A', frames: 6 }); } },
];
for (const scenario of invalid) test(`真实入口拒绝${scenario.name}并要求补齐或扩大核对`, async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = (await fixture(t)); scenario.change(f); f.save();
  const result = (await f.run());
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.report.status, 'failed');
  assert.equal(result.report.affected.complete, false);
  assert.equal(result.report.affected.requiresExpandedScope, true);
  assert.match(result.report.checks[0].message, /补齐.*扩大核对/);
  assert.equal(result.report.details?.unchanged, undefined);
});

test('共享素材改变影响所有实际消费者及其间接输出，C与配音可复用', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = (await fixture(t));
  (await ffmpeg(t, ['-f', 'lavfi', '-i', 'color=c=black:s=8x8', '-frames:v', '1', '-update', '1', join(f.project, '共享素材.png')]));
  const result = (await f.run());
  assert.equal(result.status, 1, result.stdout);
  assert.deepEqual(result.report.affected.segments, ['A', 'B']);
  assert.ok(result.report.affected.outputs.every((n: { causeIds: string[] }) => n.causeIds.includes('shared')));
  assert.ok(result.report.details.unchanged.some((n: { id: string }) => n.id === 'C-assembly'));
  assert.equal(result.report.details.unchanged.filter((n: { kind: string }) => n.kind === 'audio').length, 3);
});

test('片段帧长改变只扩大该片段及实际消费它末帧的相邻输出', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = (await fixture(t)); f.segments[0]!.frames = 7; f.save();
  const result = (await f.run());
  assert.equal(result.status, 1, result.stdout);
  assert.deepEqual(result.report.affected.segments, ['A', 'B']);
  assert.ok(result.report.details.configurationChanges.some((c: { id: string }) => c.id === 'render:A:frames'));
});

test('缺少渲染参数基线不能认定全部旧输出仍有效', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = (await fixture(t)); f.manifest.dependencies.renderInputs = undefined; f.save();
  const result = (await f.run());
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.report.status, 'pending');
  assert.equal(result.report.affected.complete, false);
  assert.equal(result.report.affected.outputs.length, 8);
  assert.ok(result.report.checks.some((c: { id: string; status: string }) => c.id === 'render-input-baseline' && c.status === 'pending'));
});

test('帧率或片段顺序变化也扩大核对，无关制作约定文字变化不使媒体失效', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = (await fixture(t));
  writeFileSync(join(f.project, 'video.md'), '增加无关制作说明，媒体和确认范围未变。');
  assert.equal((await f.run()).status, 0);
  f.manifest.project.fps = 12; f.save();
  const changedRate = (await f.run());
  assert.equal(changedRate.status, 1);
  assert.deepEqual(changedRate.report.affected.segments, ['A', 'B', 'C']);
  f.manifest.project.fps = 10;
  f.segments.reverse(); f.save();
  const changedOrder = (await f.run());
  assert.equal(changedOrder.status, 1);
  assert.ok(changedOrder.report.details.configurationChanges.some((c: { id: string }) => c.id === 'render:segment-order'));
});
