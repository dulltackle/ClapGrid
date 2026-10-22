import { test, type ResourceFixtures } from './helpers/resource-test.js';
import assert from 'node:assert/strict';
import { vi } from 'vitest';
import { writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

type Resources = Pick<ResourceFixtures, 'command' | 'createDirectory'>;

const entry = fileURLToPath(new URL('../scripts/production.mjs', import.meta.url));
function fixture(t: Pick<Resources, 'command' | 'createDirectory'>) {
  const project = t.createDirectory(join(tmpdir(), '制作证据 中文 '));
  writeFileSync(join(project, '产物.txt'), '已审阅内容');
  const sha256 = createHash('sha256').update('已审阅内容').digest('hex');
  const evidence = {
    schemaVersion: 1, reviewVersion: 'review-2',
    requirements: [{ id: 'R1', text: '技术检查与用户视觉确认均已完成', classifiedBy: { source: 'human', identity: '项目作者' }, required: [
      { id: 'technical', kind: 'ran', artifact: '产物.txt', scope: ['A'] },
      { id: 'visual', kind: 'user', artifact: '产物.txt', scope: ['A'] },
    ] }],
    records: [{ id: 'E1', requirement: 'R1', criterion: 'technical', kind: 'ran', reviewVersion: 'review-2', reuseOf: undefined as string | undefined,
      artifact: { path: '产物.txt', sha256 }, scope: ['A'], status: 'passed', source: 'controlled-test',
      provenance: { actor: '受控测试执行者', record: '受控测试模拟执行结果', observedAt: '2026-10-13T00:00:00Z' } }],
  };
  writeFileSync(join(project, 'production.json'), JSON.stringify({ schemaVersion: 1, project: { width: 8, height: 8, fps: 10 }, typecheck: 'tsconfig.json',
    segments: [{ id: 'A', card: 'card.json', source: 'source.ts', audio: 'audio.wav', frames: 1, assembly: 'assembly.mp4', review: 'review.mp4' }], evidence: '审阅记录.json' }));
  const save = () => writeFileSync(join(project, '审阅记录.json'), JSON.stringify(evidence));
  save();
  const run = async (output = join(project, '结果.json')) => {
    const result = (await t.command(process.execPath, [entry, 'evidence', '--project', project, '--report', output], { encoding: 'utf8' }));
    const actualReport = result.stdout.match(/完整报告：(.+)\n/)?.[1] ?? output;
    return { ...result, reportPath: actualReport, report: JSON.parse(readFileSync(actualReport, 'utf8')) };
  };
  return { project, evidence, save, run };
}

test('技术证据通过但混合条款仍缺人工确认时保持待审且不允许回写', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = fixture(t);
  const before = readFileSync(join(f.project, '审阅记录.json'));
  const result = (await f.run());
  assert.equal(result.status, 1);
  assert.equal(result.report.status, 'pending', result.stdout);
  assert.equal(result.report.details.requirements[0].status, 'pending');
  assert.equal(result.report.details.requirements[0].writeBackAllowed, false);
  assert.equal(result.report.checks.find((c: { id: string }) => c.id === 'R1:visual').status, 'pending');
  assert.deepEqual(readFileSync(join(f.project, '审阅记录.json')), before);
});

test('全部对应证据完整时机械检查通过，受控测试记录仍不允许实际回写', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = fixture(t);
  f.evidence.requirements[0]!.required.push({ id: 'reading', kind: 'reviewed', artifact: '产物.txt', scope: ['A'] });
  const base = f.evidence.records[0]!;
  f.evidence.records.push({ ...base, id: 'E2', criterion: 'visual', kind: 'user' }, { ...base, id: 'E3', criterion: 'reading', kind: 'reviewed' });
  f.save();
  const result = (await f.run());
  assert.equal(result.status, 0, result.stdout);
  const requirement = result.report.details.requirements[0];
  assert.equal(requirement.status, 'passed');
  assert.equal(requirement.earned, true);
  assert.equal(requirement.controlledTest, true);
  assert.equal(requirement.writeBackAllowed, false);
  assert.deepEqual(requirement.evidenceIds, ['E1', 'E2', 'E3']);
});

test('当前版本记录声明复用时必须能追溯到有效原证据，缺失关联不能通过', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = fixture(t);
  f.evidence.records.push({ ...f.evidence.records[0]!, id: 'E2', criterion: 'visual', kind: 'user', reuseOf: 'missing-origin' });
  f.save();
  const result = (await f.run());
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.report.status, 'failed');
  assert.match(result.report.checks.find((c: { id: string }) => c.id === 'R1:visual').message, /复用.*不存在/);
});

const incomplete: { name: string; change: (record: ReturnType<typeof fixture>['evidence']['records'][number]) => void; expected: string }[] = [
  { name: '人工待审', change: record => { record.status = 'pending'; }, expected: 'pending' },
  { name: '用户否决', change: record => { record.status = 'denied'; }, expected: 'failed' },
  { name: '执行失败', change: record => { record.status = 'failed'; }, expected: 'failed' },
  { name: '跳过', change: record => { record.status = 'skipped'; }, expected: 'skipped' },
  { name: '错误审阅版本', change: record => { record.reviewVersion = 'review-old'; }, expected: 'failed' },
  { name: '错误范围', change: record => { record.scope = ['B']; }, expected: 'failed' },
  { name: '错误类型', change: record => { record.kind = 'reviewed'; }, expected: 'failed' },
  { name: '错误来源', change: record => { record.source = 'execution'; }, expected: 'failed' },
  { name: '错误产物路径', change: record => { record.artifact = { ...record.artifact, path: '其他产物.txt' }; }, expected: 'failed' },
  { name: '错误内容身份', change: record => { record.artifact = { ...record.artifact, sha256: '0'.repeat(64) }; }, expected: 'failed' },
];
for (const scenario of incomplete) test(`真实入口将${scenario.name}定位到子项，整条不得回写`, async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = fixture(t);
  writeFileSync(join(f.project, '其他产物.txt'), '已审阅内容');
  const record = { ...f.evidence.records[0]!, id: 'E2', criterion: 'visual', kind: 'user' };
  scenario.change(record); f.evidence.records.push(record); f.save();
  const result = (await f.run());
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.report.status, scenario.expected);
  const failed = result.report.checks.find((c: { id: string }) => c.id === 'R1:visual');
  assert.equal(failed.status, scenario.expected);
  assert.ok(failed.path);
  assert.equal(result.report.details.requirements[0].earned, false);
  assert.equal(result.report.details.requirements[0].writeBackAllowed, false);
});

test('内容与范围不变可显式复用旧版本，记录文字变化不会使媒体确认失效', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = fixture(t);
  const original = { ...f.evidence.records[0]!, id: 'original-user', criterion: 'visual', kind: 'user', reviewVersion: 'review-1' };
  f.evidence.records.push(original, { ...original, id: 'reuse-user', reviewVersion: 'review-2', reuseOf: original.id });
  f.save();
  const first = (await f.run());
  assert.equal(first.status, 0, first.stdout);
  const proof = first.report.checks.find((c: { id: string }) => c.id === 'R1:visual');
  assert.deepEqual(proof.reusedFrom, ['original-user']);
  assert.deepEqual(proof.provenance, original.provenance);
  assert.equal(proof.source, original.source);
  f.evidence.requirements[0]!.text += '（补充记录说明）';
  f.save();
  const second = (await f.run());
  assert.equal(second.status, 0, second.stdout);
  writeFileSync(join(f.project, '产物.txt'), '修改后的内容');
  const changed = (await f.run());
  assert.equal(changed.status, 1);
  assert.equal(changed.report.status, 'failed');
  assert.match(changed.report.checks.find((c: { id: string }) => c.id === 'R1:visual').message, /内容摘要已变化/);
});

test('复用原记录的否决、变更范围与循环关联均不能被新版本覆盖', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = fixture(t);
  const original = { ...f.evidence.records[0]!, id: 'old-user', criterion: 'visual', kind: 'user', reviewVersion: 'review-1' };
  f.evidence.records.push(original, { ...original, id: 'new-user', reviewVersion: 'review-2', reuseOf: original.id });
  for (const invalidation of ['denied', 'scope', 'cycle', 'identity', 'provenance']) {
    original.status = invalidation === 'denied' ? 'denied' : 'passed';
    original.scope = invalidation === 'scope' ? ['B'] : ['A'];
    original.reuseOf = invalidation === 'cycle' ? 'new-user' : undefined;
    original.requirement = invalidation === 'identity' ? 'other-requirement' : 'R1';
    original.provenance = { ...original.provenance, observedAt: invalidation === 'provenance' ? '2026-10-12T00:00:00Z' : '2026-10-13T00:00:00Z' };
    f.save();
    const result = (await f.run());
    assert.equal(result.status, 1, result.stdout);
    assert.equal(result.report.checks.find((c: { id: string }) => c.id === 'R1:visual').status, 'failed');
  }
});

test('原始项目证据与历史档案保持原字节，工具只输出回写判定', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = fixture(t);
  f.evidence.records.push({ ...f.evidence.records[0]!, id: 'E2', criterion: 'visual', kind: 'user' });
  f.save();
  writeFileSync(join(f.project, '历史记录.json'), '{"尚未审阅":true,"来源":"#104历史示例，受控测试"}\n');
  const files = ['production.json', '审阅记录.json', '历史记录.json', '产物.txt'];
  const before = files.map(file => readFileSync(join(f.project, file)));
  const result = (await f.run());
  assert.equal(result.status, 0, result.stdout);
  files.forEach((file, index) => assert.deepEqual(readFileSync(join(f.project, file)), before[index]));
});

test('显式复用也不能绕过同一内容与范围的新否决或待审结论', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = fixture(t);
  const original = { ...f.evidence.records[0]!, id: 'old-pass', criterion: 'visual', kind: 'user', reviewVersion: 'review-1' };
  const newer = { ...original, id: 'newer-decision', reviewVersion: 'review-1-followup', status: 'denied',
    provenance: { ...original.provenance, actor: '另一位受控模拟审阅者', record: '受控测试后续结论', observedAt: '2026-10-13T01:00:00Z' } };
  f.evidence.records.push(original, newer, { ...original, id: 'reused-pass', reviewVersion: 'review-2', reuseOf: original.id });
  for (const status of ['denied', 'pending', 'failed', 'skipped']) {
    newer.status = status; f.save();
    const result = (await f.run());
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.report.checks.find((c: { id: string }) => c.id === 'R1:visual').message, /最新.*结论/);
  }
});

test('受控历史通过与类型不合格的历史来源都不能覆盖真实来源否决', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = fixture(t);
  f.evidence.requirements[0]!.required.shift();
  const original = { ...f.evidence.records[0]!, id: 'real-old-pass', criterion: 'visual', kind: 'user', reviewVersion: 'review-1', source: 'user-confirmation',
    provenance: { actor: '受控模拟真实来源（非实际用户确认）', record: '受控漏洞回归T1', observedAt: '2026-10-13T00:00:00Z' } };
  const denial = { ...original, id: 'real-denial', reviewVersion: 'review-1-followup', status: 'denied',
    provenance: { ...original.provenance, record: '受控漏洞回归T2', observedAt: '2026-10-13T01:00:00Z' } };
  const contamination = { ...original, id: 'historical-pass', reviewVersion: 'other-history', source: 'controlled-test',
    provenance: { actor: '受控测试', record: '受控漏洞回归T3', observedAt: '2026-10-13T02:00:00Z' } };
  f.evidence.records = [original, denial, { ...original, id: 'current-reuse', reviewVersion: 'review-2', reuseOf: original.id }, contamination];
  for (const source of ['controlled-test', 'execution']) {
    contamination.source = source; f.save();
    const result = (await f.run());
    assert.equal(result.status, 1, result.stdout);
    assert.equal(result.report.status, 'failed');
    assert.equal(result.report.details.requirements[0].writeBackAllowed, false);
    assert.match(result.report.checks[0].message, /最新.*结论/);
  }
});

for (const collision of ['产物直接路径', '产物别名到真实文件', '报告别名到产物', '原证明文件', '原证明别名到真实文件']) test(`报告拒绝覆盖证据的${collision}并另存失败结果`, async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = fixture(t);
  f.evidence.records.push({ ...f.evidence.records[0]!, id: 'E2', criterion: 'visual', kind: 'user' });
  const realFile = '原技术报告.json';
  const alias = '技术报告别名.json';
  let reportPath = join(f.project, realFile);
  if (collision === '报告别名到产物') reportPath = join(f.project, alias);
  const previous = JSON.stringify({ schemaVersion: 1, report: reportPath, startedAt: '2026-10-13T00:00:00Z', checks: [], original: '应保留的受控测试技术原件' });
  writeFileSync(join(f.project, realFile), previous);
  if (collision.includes('别名')) symlinkSync(realFile, join(f.project, alias));
  if (collision.startsWith('原证明')) {
    for (const record of f.evidence.records) record.provenance = { ...record.provenance, record: collision.includes('别名') ? alias : realFile };
  } else {
    const artifact = collision === '产物别名到真实文件' ? alias : realFile;
    for (const criterion of f.evidence.requirements[0]!.required) criterion.artifact = artifact;
    for (const record of f.evidence.records) record.artifact = { path: artifact, sha256: createHash('sha256').update(previous).digest('hex') };
  }
  f.save();
  const before = readFileSync(join(f.project, '审阅记录.json'));
  const result = (await f.run(reportPath));
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.report.status, 'failed');
  assert.notEqual(result.reportPath, reportPath);
  assert.match(result.stdout, /拒绝覆盖/);
  assert.equal(readFileSync(join(f.project, realFile), 'utf8'), previous);
  assert.deepEqual(readFileSync(join(f.project, '审阅记录.json')), before);
});

test('公开业务结果按要求和子项身份分别定位，报告转换保留碰撞检查标识', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = fixture(t);
  const base = f.evidence.records[0]!;
  f.evidence.requirements = [
    { ...f.evidence.requirements[0]!, id: 'R:part', required: [{ id: 'visual', kind: 'user', artifact: '产物.txt', scope: ['A'] }] },
    { ...f.evidence.requirements[0]!, id: 'R', required: [{ id: 'part:visual', kind: 'user', artifact: '产物.txt', scope: ['A'] }] },
  ];
  f.evidence.records = [
    { ...base, id: 'E1', requirement: 'R:part', criterion: 'visual', kind: 'user' },
    { ...base, id: 'E2', requirement: 'R', criterion: 'part:visual', kind: 'user', status: 'pending' },
  ];
  f.save();
  const api = await import(new URL('../scripts/production/evidence.mjs', import.meta.url).href);
  const result = await api.evaluateEvidence({ project: f.project, manifest: 'production.json', report: '', args: [] });
  assert.equal(result.requirements[0]?.criteria[0]?.id, 'visual');
  assert.equal(result.requirements[1]?.criteria[0]?.id, 'part:visual');
  assert.equal(result.requirements[0]?.criteria[0]?.status, 'passed');
  assert.equal(result.requirements[1]?.criteria[0]?.status, 'pending');
  assert.equal(result.requirements[0]?.criteria[0]?.evidence?.id, 'E1');
  assert.equal(result.requirements[1]?.criteria[0]?.evidence?.id, 'E2');
  const report = api.evidenceReport(result);
  assert.deepEqual(report.checks.map((check: { id: string }) => check.id), ['R:part:visual', 'R:part:visual']);
  const cli = (await f.run());
  assert.equal(cli.status, 1);
  assert.deepEqual(cli.report.checks, report.checks);
  assert.deepEqual(cli.report.details, report.details);
});

test('真实来源的新否决不污染受控历史分组的机械判断', async ({ command, createDirectory }) => {
  const t = { command, createDirectory };
  const f = fixture(t);
  f.evidence.requirements[0]!.required.shift();
  const current = { ...f.evidence.records[0]!, id: 'controlled-current', criterion: 'visual', kind: 'user' };
  const realDenial = { ...current, id: 'real-denial', source: 'user-confirmation', status: 'denied', reviewVersion: 'other-review',
    provenance: { actor: '隔离机制测试模拟真实声明者', record: '模拟否决，非实际审阅', observedAt: '2026-10-13T01:00:00Z' } };
  f.evidence.records = [current, realDenial]; f.save();
  const result = (await f.run());
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.report.details.requirements[0].controlledTest, true);
  assert.equal(result.report.details.requirements[0].writeBackAllowed, false);
});
