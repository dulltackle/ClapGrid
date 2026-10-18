import assert from 'node:assert/strict';
import { test, vi, type TestContext } from 'vitest';

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// 原 Node 文件未设置测试及清理时限；仅本迁移文件保留相同语义。
vi.setConfig({ testTimeout: 0, hookTimeout: 0 });

// 隔离机制测试：声明的真实来源仅用于验证规则，不构成实际用户审阅或制作许可。
const api = await import(new URL('../scripts/production/evidence.mjs', import.meta.url).href);
function fixture(t: TestContext) {
  const project = mkdtempSync(join(tmpdir(), '证据复核 机制测试 '));
  t.onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  for (const id of ['A', 'B']) writeFileSync(join(project, `${id}.txt`), `已审阅产物 ${id}`);
  const required = ['A', 'B'].map(id => ({ id, kind: 'user', artifact: `${id}.txt`, scope: [id] }));
  const records = required.flatMap(criterion => {
    const original = { id: `old-${criterion.id}`, requirement: 'visual', criterion: criterion.id, kind: 'user', reviewVersion: 'v1',
      artifact: { path: criterion.artifact, sha256: createHash('sha256').update(`已审阅产物 ${criterion.id}`).digest('hex') },
      scope: criterion.scope, status: 'passed', source: 'user-confirmation', reuseOf: undefined as string | undefined,
      provenance: { actor: '隔离模拟声明者，非实际用户', record: '机制测试模拟证明', observedAt: '2026-10-14T00:00:00Z' } };
    return [original, { ...original, id: `current-${criterion.id}`, reviewVersion: 'v2', reuseOf: original.id }];
  });
  const evidence = { schemaVersion: 1, reviewVersion: 'v2', requirements: [{ id: 'visual', classifiedBy: { source: 'human', identity: '隔离机制测试模拟分类者' }, required }], records };
  writeFileSync(join(project, 'production.json'), JSON.stringify({ schemaVersion: 1, project: { width: 8, height: 8, fps: 10 }, typecheck: 'tsconfig.json',
    segments: [{ id: 'A', card: 'card.json', source: 'source.ts', audio: 'audio.wav', frames: 1, assembly: 'assembly.mp4', review: 'review.mp4' }], evidence: 'evidence.json' }));
  const save = () => writeFileSync(join(project, 'evidence.json'), JSON.stringify(evidence));
  save();
  const evaluate = () => api.evaluateEvidence({ project, manifest: 'production.json', report: '', args: [] });
  return { project, evidence, save, evaluate };
}

test('公开业务接口保留原核对结果并独立复核不同影响集合，同步收回整条回写资格', async t => {
  const f = fixture(t);
  const original = await f.evaluate();
  const before = structuredClone(original);
  assert.equal(original.requirements[0].writeBackAllowed, true);
  const impactA = [{ path: join(f.project, 'A.txt'), causeIds: ['source-A'], reasonChains: [['source-A', 'output-A']] }];
  const first = api.recheckEvidence(original, impactA);
  assert.deepEqual(original, before);
  assert.equal(first.status, 'pending');
  assert.equal(first.requirements[0].criteria[0].status, 'pending');
  assert.equal(first.requirements[0].criteria[1].status, 'passed');
  assert.equal(first.requirements[0].status, 'pending');
  assert.equal(first.requirements[0].earned, false);
  assert.equal(first.requirements[0].controlledTest, false);
  assert.equal(first.requirements[0].writeBackAllowed, false);
  assert.deepEqual(first.requirements[0].criteria[0].dependencyImpact.reasonChains, [['source-A', 'output-A']]);
  assert.deepEqual(first.requirements[0].criteria[0].proof, before.requirements[0].criteria[0].proof);
  const second = api.recheckEvidence(original, [{ path: join(f.project, 'B.txt'), causeIds: ['source-B'], reasonChains: [['source-B', 'output-B']] }]);
  assert.equal(second.requirements[0].criteria[0].status, 'passed');
  assert.equal(second.requirements[0].criteria[1].status, 'pending');
  assert.equal(first.requirements[0].criteria[0].status, 'pending');
  assert.equal(first.requirements[0].criteria[1].status, 'passed');
  assert.deepEqual(api.recheckEvidence(original, []), before);
  assert.deepEqual(api.recheckEvidence(original, impactA), first);
  assert.deepEqual(original, before);
});


test('复核保持已有否决失败待审跳过及受控限制，不提升或掩盖原结论', async t => {
  const f = fixture(t);
  const statuses = ['failed', 'denied', 'pending', 'skipped', 'passed'];
  f.evidence.requirements[0]!.required = statuses.map(id => ({ id, kind: 'user', artifact: 'A.txt', scope: ['A'] }));
  const base = f.evidence.records[0]!;
  f.evidence.records = statuses.map(status => ({ ...base, id: status, criterion: status, status, reviewVersion: 'v2', reuseOf: undefined, source: 'controlled-test' }));
  f.save();
  const original = await f.evaluate();
  const before = structuredClone(original);
  const result = api.recheckEvidence(original, [{ path: join(f.project, 'A.txt'), causeIds: ['changed-input'], reasonChains: [['changed-input', 'A']] }]);
  assert.deepEqual(result.requirements[0].criteria.map((criterion: { status: string }) => criterion.status), ['failed', 'failed', 'pending', 'skipped', 'pending']);
  assert.equal(result.status, 'failed');
  assert.equal(result.requirements[0].status, 'failed');
  assert.equal(result.requirements[0].earned, false);
  assert.equal(result.requirements[0].controlledTest, true);
  assert.equal(result.requirements[0].writeBackAllowed, false);
  assert.deepEqual(result.requirements[0].evidenceIds, ['failed', 'denied', 'pending', 'skipped', 'passed']);
  for (const criterion of result.requirements[0].criteria.slice(0, 4)) {
    assert.equal(criterion.previousStatus, undefined);
    assert.deepEqual(criterion.proof, before.requirements[0].criteria.find((value: { id: string }) => value.id === criterion.id).proof);
    assert.deepEqual(criterion.dependencyImpact.causeIds, ['changed-input']);
  }
  assert.equal(result.requirements[0].criteria[4].previousStatus, 'passed');
  assert.deepEqual(original, before);
  const report = api.evidenceReport(result);
  assert.equal(report.checks[0].dependencyAffected, undefined);
  assert.equal(report.checks[4].dependencyAffected, true);
});
