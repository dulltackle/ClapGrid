import { projectCleanup } from './helpers/project-cleanup.js';
import { command as runCommand } from './helpers/vitest-command.js';
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync, readdirSync, existsSync, symlinkSync, linkSync, mkdirSync, openSync, writeSync, closeSync, statSync, watch } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash, randomBytes } from 'node:crypto';
import { archiveBaseline, archiveBaselinePath } from './helpers/archive-baseline.js';


const cli = resolve('scripts/production.mjs');
const tar = createRequire(import.meta.url)('tar-stream');
function fixture() {
  const project = mkdtempSync(join(tmpdir(), 'clapgrid-publication-'));
  cpSync(archiveBaselinePath('project'), project, { recursive: true });
  return project;
}
async function run(project: string, command: string, args: string[] = []) {
  const report = join(project, `report-${command}.json`);
  const result = (await runCommand(process.execPath, [cli, command, '--project', project, '--report', report, ...args], { encoding: 'utf8', env: { ...process.env, PATH: project } }));
  assert.equal(result.error, undefined);
  assert.ok(existsSync(report), result.stdout + result.stderr);
  return { ...result, report: JSON.parse(readFileSync(report, 'utf8')) };
}
async function inspect(path: string) {
  const extractor = tar.extract();
  const pump = pipeline(Readable.from([gunzipSync(readFileSync(path))]), extractor);
  const members = new Map<string, Buffer>();
  for await (const stream of extractor) {
    const parts: Buffer[] = [];
    for await (const bytes of stream) parts.push(bytes);
    members.set(stream.header.name, Buffer.concat(parts));
  }
  await pump;
  return members;
}

test('真实 pack 无 Python 发布新 v1 包，全部成员与独立旧清单和索引原字节完全一致', async t => {
  const project = fixture(); projectCleanup(t).directory(project);
  const result = (await run(project, 'pack'));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.report.details.publication, 'published');
  const members = await inspect(join(project, 'delivery.tar.gz'));
  assert.deepEqual([...members.keys()], archiveBaseline.success.legacyResult.details!.order);
  for (const expected of archiveBaseline.success.members) {
    const original = expected.path === '.clapgrid-package.json' ? readFileSync(archiveBaselinePath('expected-index.json')) : readFileSync(join(project, expected.path));
    assert.deepEqual(members.get(expected.path), original, expected.path);
  }
  assert.equal((await run(project, 'verify-package', ['--archive', join(project, 'delivery.tar.gz')])).status, 0);
  assert.equal(readdirSync(project).some(name => name.includes('.candidate-')), false);
});

test('显式历史待审、否决和人工确认原件保持原字节，归档成功不改变记录含义', async t => {
  const project = fixture(); projectCleanup(t).directory(project);
  const contents = new Map([
    ['历史待审.json', '{"status":"pending","reviewVersion":"old"}\n'],
    ['历史否决.json', '{"status":"rejected","reason":"未通过审阅"}\n'],
    ['人工确认.json', '{"source":"human","status":"approved","scope":"固定旧版本"}\n'],
  ]);
  const additions = [];
  for (const [name, bytes] of contents) {
    writeFileSync(join(project, name), bytes);
    additions.push(JSON.stringify({ path: name, category: name === '人工确认.json' ? 'user' : 'history', sha256: createHash('sha256').update(bytes).digest('hex') }));
  }
  const manifest = join(project, 'production.json');
  writeFileSync(manifest, readFileSync(manifest, 'utf8').replace('"files":[\n ', '"files":[\n ' + additions.join(',\n ') + ',\n '));
  const result = (await run(project, 'pack'));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.report.details.scope, /不判定人工确认/);
  const members = await inspect(join(project, 'delivery.tar.gz'));
  for (const [name, bytes] of contents) {
    assert.equal(members.get(name)?.toString(), bytes, name);
    assert.equal(readFileSync(join(project, name), 'utf8'), bytes, name);
  }
});

for (const kind of ['input', 'manifest', 'symlink-input', 'hardlink-input', 'parent-alias', 'index', 'dangling-index', 'parent-index', 'hardlink-index']) {
  test(`真实 pack 拒绝输出 ${kind} 别名，原件不变且不虚报候选`, async t => {
    const project = fixture(); projectCleanup(t).directory(project);
    const originals = new Map(archiveBaseline.success.members.filter(member => member.path !== '.clapgrid-package.json').map(member => [member.path, readFileSync(join(project, member.path))]));
    let output = join(project, 'src.ts');
    if (kind === 'manifest') output = join(project, 'production.json');
    if (kind === 'symlink-input') { output = join(project, 'alias.tar.gz'); symlinkSync('src.ts', output); }
    if (kind === 'hardlink-input') { output = join(project, 'alias.tar.gz'); linkSync(join(project, 'src.ts'), output); }
    if (kind === 'parent-alias' || kind === 'parent-index') { symlinkSync(project, join(project, 'alias'), 'dir'); output = join(project, 'alias', kind === 'parent-alias' ? 'src.ts' : '.clapgrid-package.json'); }
    if (kind === 'index') output = join(project, '.clapgrid-package.json');
    if (kind === 'dangling-index') { output = join(project, 'alias.tar.gz'); symlinkSync('.clapgrid-package.json', output); }
    if (kind === 'hardlink-index') { writeFileSync(join(project, '.clapgrid-package.json'), 'reserved'); output = join(project, 'alias.tar.gz'); linkSync(join(project, '.clapgrid-package.json'), output); }
    const result = (await run(project, 'pack', ['--output', output]));
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(JSON.stringify(result.report), /输出路径.*拒绝覆盖/);
    assert.equal(result.report.details.publication, 'not-published');
    assert.equal(result.report.details.candidate, undefined);
    assert.equal(readdirSync(project).some(name => name.includes('.candidate-')), false);
    for (const [name, bytes] of originals) assert.deepEqual(readFileSync(join(project, name)), bytes, name);
  });
}

/** 真实低压缩率大成员为候选事件与后续读取留可观察窗口，不依赖内部函数或计数。 */
function largeFixture(project: string) {
  const block = randomBytes(1024 * 1024), hash = createHash('sha256');
  const handle = openSync(join(project, 'large.bin'), 'wx');
  try { for (let index = 0; index < 32; index++) { writeSync(handle, block); hash.update(block); } }
  finally { closeSync(handle); }
  const entry = JSON.stringify({ path: 'large.bin', category: 'production', sha256: hash.digest('hex') });
  const path = join(project, 'production.json');
  const raw = readFileSync(path, 'utf8');
  assert.ok(raw.includes('"files":[\n '));
  writeFileSync(path, raw.replace('"files":[\n ', '"files":[\n ' + entry + ',\n '));
}

async function observedPack(project: string, action?: (candidate: string) => void, afterWrite = false, limited = false) {
  const report = join(project, 'report-pack.json');
  let observed = false, observationError: unknown;
  const watcher = watch(project, { persistent: false }, (_, name) => {
    if (observed || !name?.toString().startsWith('.delivery.tar.gz.candidate-')) return;
    const candidate = join(project, name.toString());
    try {
      if (!existsSync(candidate) || (afterWrite && statSync(candidate).size < 16)) return;
      observed = true; action?.(candidate);
    } catch (error) { observationError = error; }
  });
  const args = [cli, 'pack', '--project', project, '--report', report];
  let child;
  if (limited) {
    const preload = join(project, 'limited-write.mjs');
    writeFileSync(preload, "process.on('SIGXFSZ', () => {});\n");
    child = runCommand('/bin/bash', ['-c', 'ulimit -f 64; exec "$@"', 'clapgrid-file-limit', process.execPath, '--import', preload, ...args], { env: { ...process.env, PATH: project }, timeout: 30000 });
  } else child = runCommand(process.execPath, args, { env: { ...process.env, PATH: project }, timeout: 30000 });
  try {
    const { status: code, stdout, stderr } = await child;
    if (observationError) throw observationError;
    assert.ok(observed, '必须实际观察到候选文件创建/写入事件');
    const location = stdout.match(/完整报告：(.*)/)?.[1];
    assert.ok(location, stdout + stderr);
    return { code, stdout, stderr, report: JSON.parse(readFileSync(location, 'utf8')) };
  } finally { watcher.close(); }
}

for (const kind of ['changed-input', 'missing-input', 'bad-candidate', 'report-directory', 'report-hardlink']) {
  test(`真实候选事件之后 ${kind} 保留正式包、候选及报告的正确实际状态`, { timeout: 40_000 }, async t => {
    const project = fixture(); projectCleanup(t).directory(project);
    assert.equal((await run(project, 'pack')).status, 0);
    const archive = join(project, 'delivery.tar.gz'), original = readFileSync(archive);
    largeFixture(project);
    const originalCard = readFileSync(join(project, 'card.json'));
    const result = await observedPack(project, candidate => {
      if (kind === 'changed-input') writeFileSync(join(project, 'review.mp4'), 'changed');
      if (kind === 'missing-input') rmSync(join(project, 'review.mp4'));
      if (kind === 'bad-candidate') {
        const handle = openSync(candidate, 'r+');
        try { writeSync(handle, Buffer.from([0]), 0, 1, 0); } finally { closeSync(handle); }
      }
      if (kind === 'report-directory') { rmSync(join(project, 'report-pack.json')); mkdirSync(join(project, 'report-pack.json')); }
      if (kind === 'report-hardlink') { rmSync(join(project, 'report-pack.json')); linkSync(join(project, 'card.json'), join(project, 'report-pack.json')); }
    }, kind === 'bad-candidate');
    assert.equal(result.code, 1, result.stdout + result.stderr);
    if (kind.startsWith('report-')) {
      assert.equal(result.report.details.publication, 'published');
      assert.ok(result.report.checks.some((check: { id: string; status: string }) => check.id === 'report' && check.status === 'failed'));
      assert.notDeepEqual(readFileSync(archive), original);
      assert.equal((await run(project, 'verify-package', ['--archive', archive])).status, 0);
      assert.equal(readdirSync(project).some(name => name.includes('.candidate-')), false);
      assert.deepEqual(readFileSync(join(project, 'card.json')), originalCard);
    } else {
      assert.equal(result.report.details.publication, 'not-published');
      assert.deepEqual(readFileSync(archive), original);
      assert.ok(existsSync(result.report.details.candidate));
      assert.match(JSON.stringify(result.report), /候选包：/);
      if (kind === 'bad-candidate') assert.equal(readFileSync(result.report.details.candidate)[0], 0);
    }
  });
}

test('真实子进程文件大小限制导致候选 EFBIG 写失败，原有效包和部分候选原样保留', { timeout: 40_000, skip: process.platform !== 'linux' }, async t => {
  const project = fixture(); projectCleanup(t).directory(project);
  assert.equal((await run(project, 'pack')).status, 0);
  const archive = join(project, 'delivery.tar.gz'), original = readFileSync(archive);
  largeFixture(project);
  const result = await observedPack(project, undefined, false, true);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(JSON.stringify(result.report), /EFBIG|file too large/);
  assert.equal(result.report.details.publication, 'not-published');
  assert.deepEqual(readFileSync(archive), original);
  assert.ok(statSync(result.report.details.candidate).size > 0);
  assert.ok(statSync(result.report.details.candidate).size <= 64 * 1024);
});
