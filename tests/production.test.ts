import { projectCleanup } from './helpers/project-cleanup.js';
import { command as runCommand } from './helpers/vitest-command.js';
import assert from 'node:assert/strict';
import { test, vi, type TestContext } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';


const entry = fileURLToPath(new URL('../scripts/production.mjs', import.meta.url));
async function media(args: string[]) {
  const result = (await runCommand('ffmpeg', ['-v', 'error', '-nostdin', '-y', ...args], { encoding: 'utf8' }));
  assert.equal(result.status, 0, result.stderr);
}
async function fixture(t: TestContext) {
  const project = mkdtempSync(join(tmpdir(), '制作 中文 项目 '));
  projectCleanup(t).directory(project);
  mkdirSync(join(project, '真实 素材'));
  writeFileSync(join(project, '源 文件.js'), 'export const segmentIds = ["A", "B"];\n');
  writeFileSync(join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { allowJs: true, checkJs: true, noEmit: true, types: [], strict: true }, files: ['源 文件.js'] }));
  (await media(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.6:sample_rate=16000', join(project, '真实 素材/配音 A.wav')]));
  (await media(['-f', 'lavfi', '-i', 'color=c=blue:s=64x48:r=10:d=0.6', '-c:v', 'ffv1', join(project, '真实 素材/装配 A.mkv')]));
  (await media(['-i', join(project, '真实 素材/装配 A.mkv'), '-i', join(project, '真实 素材/配音 A.wav'), '-c', 'copy', join(project, '真实 素材/审阅 A.mkv')]));
  const segment = { id: 'A', name: '组合显示名 A+B', card: '组合 制作卡.json', source: '源 文件.js', audio: '真实 素材/配音 A.wav', frames: 6, assembly: '真实 素材/装配 A.mkv', review: '真实 素材/审阅 A.mkv' };
  const manifest = { schemaVersion: 1, project: { width: 64, height: 48, fps: 10 }, typecheck: 'tsconfig.json', segments: [segment] };
  writeFileSync(join(project, segment.card), JSON.stringify({ segments: [{ id: 'A', source: segment.source, audio: segment.audio }, { id: 'B', source: segment.source, audio: '真实 素材/另一个配音.wav' }] }));
  const save = () => writeFileSync(join(project, 'production.json'), JSON.stringify(manifest));
  save();
  return { project, manifest, segment, save };
}
async function run(project: string, extra: string[] = [], env = process.env) {
  const report = join(project, '结果 report.json');
  const result = (await runCommand(process.execPath, [entry, 'check', '--project', project, '--report', report, ...extra], { encoding: 'utf8', env }));
  return { ...result, report: JSON.parse(readFileSync(report, 'utf8')) };
}

test('真实入口检查中文和空格路径及组合显示名映射，报告范围并保留输入', async t => {
  const f = (await fixture(t));
  const inputs = ['production.json', 'tsconfig.json', f.segment.card, f.segment.source, f.segment.audio, f.segment.assembly, f.segment.review];
  const before = inputs.map(file => readFileSync(join(f.project, file)));
  const result = (await run(f.project));
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(result.report.status, 'passed');
  assert.equal(result.report.command, 'check');
  assert.match(result.stdout, /passed/);
  assert.ok(result.report.checks.some((c: { id: string; status: string }) => c.id === 'A:audio-correspondence' && c.status === 'passed'));
  inputs.forEach((file, index) => assert.deepEqual(readFileSync(join(f.project, file)), before[index]));
});

test('失败报告不能覆盖项目清单，另存可追溯失败结果', async t => {
  const f = (await fixture(t));
  const before = readFileSync(join(f.project, 'production.json'));
  const result = (await runCommand(process.execPath, [entry, 'check', '--project', f.project, '--report', join(f.project, 'production.json')], { encoding: 'utf8' }));
  assert.equal(result.status, 1);
  assert.deepEqual(readFileSync(join(f.project, 'production.json')), before);
  const path = result.stdout.match(/完整报告：(.+)\n/)?.[1];
  assert.ok(path, result.stderr + result.stdout);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).status, 'failed');
});

test('恢复音频的左右声道错位不能因混成单声道而通过', async t => {
  const f = (await fixture(t));
  const source = join(f.project, f.segment.audio);
  const swapped = join(f.project, '交换声道.wav');
  (await media(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.6:sample_rate=16000', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.6:sample_rate=16000', '-filter_complex', '[0:a][1:a]join=inputs=2:channel_layout=stereo[a]', '-map', '[a]', source]));
  (await media(['-i', source, '-af', 'pan=stereo|c0=c1|c1=c0', swapped]));
  (await media(['-i', join(f.project, f.segment.assembly), '-i', swapped, '-c', 'copy', join(f.project, f.segment.review)]));
  const result = (await run(f.project));
  assert.equal(result.status, 1);
  assert.ok(result.report.checks.some((c: { id: string; status: string }) => c.id === 'A:audio-correspondence' && c.status === 'failed'));
});

type Fixture = Awaited<ReturnType<typeof fixture>>;
const failures: { name: string; change: (f: Fixture) => void; id: string }[] = [
  { name: '缺失装配素材', change: f => rmSync(join(f.project, f.segment.assembly)), id: 'A:assembly:path' },
  { name: '损坏审阅媒体', change: f => writeFileSync(join(f.project, f.segment.review), '这是损坏文件'), id: 'A:review:media' },
  { name: '装配素材错误包含配音轨道', change: f => media(['-i', join(f.project, f.segment.review), '-c', 'copy', join(f.project, f.segment.assembly)]), id: 'A:assembly:media' },
  { name: '审阅素材没有音轨', change: f => media(['-i', join(f.project, f.segment.assembly), '-c', 'copy', join(f.project, f.segment.review)]), id: 'A:review:media' },
  { name: '稳定片段身份重复', change: f => { f.manifest.segments.push({ ...f.segment }); f.save(); }, id: 'manifest' },
  { name: '制作卡映射其他实际源文件', change: f => writeFileSync(join(f.project, f.segment.card), JSON.stringify({ segments: [{ id: 'A', source: '另一个.js', audio: f.segment.audio }] })), id: 'A:mapping' },
  { name: '错误视频帧长', change: f => { f.segment.frames = 12; f.save(); }, id: 'A:assembly:media' },
  { name: '项目尺寸与媒体不符', change: f => { f.manifest.project.width = 128; f.save(); }, id: 'A:assembly:media' },
  { name: '生产源文件出现类型错误', change: f => writeFileSync(join(f.project, f.segment.source), 'export const value = (123).missingMethod();'), id: 'production-types' },
  { name: '类型配置未覆盖制作源文件', change: f => { writeFileSync(join(f.project, '另一个.js'), 'export const value = 1;'); writeFileSync(join(f.project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { allowJs: true, checkJs: true, types: [] }, files: ['另一个.js'] })); }, id: 'production-types' },
  { name: '引用符号链接越出项目', change: f => { rmSync(join(f.project, f.segment.source)); symlinkSync('/etc/hosts', join(f.project, f.segment.source)); }, id: 'A:source:path' },
  { name: '真实配音延迟恢复产生错位', change: f => media(['-i', join(f.project, f.segment.assembly), '-i', join(f.project, f.segment.audio), '-map', '0:v:0', '-map', '1:a:0', '-af', 'adelay=120:all=1,atrim=duration=0.6', '-c:v', 'copy', '-c:a', 'pcm_s16le', join(f.project, f.segment.review)]), id: 'A:audio-correspondence' },
  { name: '配音时长与片段帧长不符', change: f => media(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.2:sample_rate=16000', join(f.project, f.segment.audio)]), id: 'A:audio:media' },
];
for (const scenario of failures) test(`真实入口拒绝${scenario.name}并定位失败`, async t => {
  const f = (await fixture(t)); scenario.change(f);
  const result = (await run(f.project));
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.report.status, 'failed');
  assert.ok(result.report.checks.some((c: { id: string; status: string }) => c.id === scenario.id && c.status === 'failed'), JSON.stringify(result.report));
  assert.match(result.stdout, /failed/);
});

test('缺失真实媒体工具明确失败并将媒体检查标为未执行', async t => {
  const f = (await fixture(t));
  const result = (await run(f.project, [], { ...process.env, PATH: '' }));
  assert.equal(result.status, 1);
  assert.equal(result.report.status, 'failed');
  assert.ok(result.report.checks.some((c: { id: string; status: string }) => c.id === 'ffmpeg' && c.status === 'failed'));
  assert.ok(result.report.checks.some((c: { id: string; status: string }) => c.id === 'A:media' && c.status === 'pending'));
});

test('指定其他相对清单且附加数据由所属命令解释', async t => {
  const f = (await fixture(t));
  writeFileSync(join(f.project, '制作 清单.json'), JSON.stringify({ ...f.manifest, evidence: '审阅.json', dependencies: { complete: false }, files: [] }));
  const result = (await run(f.project, ['--manifest', '制作 清单.json']));
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.report.manifest, '制作 清单.json');
});

test('未知命令不会冒记成功，并保存错误报告', async t => {
  const f = (await fixture(t));
  const report = join(f.project, '未知命令.json');
  const result = (await runCommand(process.execPath, [entry, 'not-a-command', '--project', f.project, '--report', report], { encoding: 'utf8' }));
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(readFileSync(report, 'utf8')).status, 'failed');
});

test('项目关闭 checkJs 时仍不能把未检查的制作 JavaScript 类型冒记通过', async t => {
  const f = (await fixture(t));
  writeFileSync(join(f.project, f.segment.source), 'export const value = (123).missingMethod();');
  writeFileSync(join(f.project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { allowJs: true, checkJs: false, types: [] }, files: [f.segment.source] }));
  const result = (await run(f.project));
  assert.equal(result.status, 1);
  const check = result.report.checks.find((c: { id: string }) => c.id === 'production-types');
  assert.equal(check.status, 'failed');
  assert.match(check.message, /源 文件.js/);
});

test('制作类型检查不会重写项目原有增量编译缓存', async t => {
  const f = (await fixture(t));
  writeFileSync(join(f.project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { allowJs: true, checkJs: true, noEmit: true, types: [], incremental: true, tsBuildInfoFile: '原有缓存.info' }, files: [f.segment.source] }));
  writeFileSync(join(f.project, '原有缓存.info'), '保留现有项目缓存');
  const result = (await run(f.project));
  assert.equal(result.status, 0, result.stdout);
  assert.equal(readFileSync(join(f.project, '原有缓存.info'), 'utf8'), '保留现有项目缓存');
});

test('相同配音样本在审阅视频时间线上延后时仍拒绝恢复错位', async t => {
  const f = (await fixture(t));
  (await media(['-i', join(f.project, f.segment.assembly), '-itsoffset', '0.1', '-i', join(f.project, f.segment.audio), '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', join(f.project, f.segment.review)]));
  const result = (await run(f.project));
  assert.equal(result.status, 1);
  assert.ok(result.report.checks.some((c: { id: string; status: string }) => c.id === 'A:audio-correspondence' && c.status === 'failed'));
});

test('项目noCheck开关不能使未检查的制作类型冒记通过', async t => {
  const f = (await fixture(t));
  writeFileSync(join(f.project, f.segment.source), 'export const value = (123).missingMethod();');
  writeFileSync(join(f.project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { allowJs: true, noCheck: true, types: [] }, files: [f.segment.source] }));
  const result = (await run(f.project));
  assert.equal(result.status, 1);
  assert.equal(result.report.checks.find((c: { id: string }) => c.id === 'production-types').status, 'failed');
});
