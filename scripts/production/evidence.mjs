import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readManifest, resolveProjectFile, failure, statusOf } from './common.mjs';

const identity = z.string().min(1);
const scope = z.array(identity).min(1).refine(values => new Set(values).size === values.length, '审阅范围不能重复');
const kind = z.enum(['ran', 'reviewed', 'user']);
const requirementSchema = z.object({
  id: identity, text: identity.optional(),
  classifiedBy: z.object({ source: z.enum(['human', 'independent-reviewer']), identity }),
  required: z.array(z.object({ id: identity, kind, artifact: identity, scope })).min(1),
});
const recordSchema = z.object({
  id: identity, requirement: identity, criterion: identity, kind,
  reviewVersion: identity, artifact: z.object({ path: identity, sha256: z.string().regex(/^[a-f0-9]{64}$/) }), scope,
  status: z.enum(['passed', 'pending', 'failed', 'skipped', 'denied']),
  reuseOf: identity.optional(),
  source: z.enum(['execution', 'independent-review', 'user-confirmation', 'actual-host', 'controlled-test']),
  provenance: z.object({ actor: identity, record: identity, observedAt: z.string().datetime({ offset: true }) }),
});
const evidenceSchema = z.object({ schemaVersion: z.literal(1), reviewVersion: identity, requirements: z.array(requirementSchema).min(1), records: z.array(recordSchema) });

/** @param {z.infer<typeof kind>} evidenceKind @param {z.infer<typeof recordSchema>['source']} source */
function matchingSource(evidenceKind, source) {
  const expected = { ran: ['execution', 'actual-host'], reviewed: ['independent-review'], user: ['user-confirmation'] };
  return source === 'controlled-test' || expected[evidenceKind].includes(source);
}

/** @param {string[]} left @param {string[]} right */
function sameScope(left, right) {
  return left.length === right.length && left.every(value => right.includes(value));
}

/** @param {string} path */
async function digest(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}

/** @param {import('./common.mjs').CommandOptions} options @returns {Promise<import('./common.mjs').CommandResult>} */
export default async function evidence(options) {
  let document;
  try {
    const { manifest } = await readManifest(options);
    if (typeof manifest.evidence !== 'string') throw new Error('清单 evidence 必须指向项目内审阅记录 JSON。');
    document = await resolveProjectFile(options.project, manifest.evidence);
    const input = evidenceSchema.parse(JSON.parse(await readFile(document, 'utf8')));
    const requirementIds = input.requirements.map(value => value.id);
    const recordIds = input.records.map(value => value.id);
    if (new Set(requirementIds).size !== requirementIds.length || new Set(recordIds).size !== recordIds.length) throw new Error('要求或证据记录的稳定 ID 重复。');
    /** @type {import('./common.mjs').Check[]} */
    const checks = [];
    const requirements = [];
    for (const requirement of input.requirements) {
      if (new Set(requirement.required.map(value => value.id)).size !== requirement.required.length) throw new Error(`要求 ${requirement.id} 的子项 ID 重复。`);
      /** @type {import('./common.mjs').Check[]} */
      const requiredChecks = [];
      /** @type {string[]} */
      const evidenceIds = [];
      let controlledTest = false;
      for (const criterion of requirement.required) {
        const id = `${requirement.id}:${criterion.id}`;
        const records = input.records.filter(record => record.requirement === requirement.id && record.criterion === criterion.id);
        const candidates = records.filter(record => record.reviewVersion === input.reviewVersion);
        if (!candidates.length) {
          requiredChecks.push({ id, status: records.length ? 'failed' : 'pending', path: document, message: records.length ? '证据属于其他审阅版本，不能自动继承通过。' : '缺少对应证据，仍需执行或审阅。' });
          continue;
        }
        if (candidates.length !== 1) { requiredChecks.push(failure(id, '当前审阅版本有多个证据记录，需明确唯一对应记录。', document)); continue; }
        const record = candidates[0];
        if (!record) continue;
        evidenceIds.push(record.id);
        controlledTest ||= record.source === 'controlled-test';
        try {
          if (record.kind !== criterion.kind) throw new Error('证据类型与人提供的要求分类不匹配。');
          if (!sameScope(record.scope, criterion.scope)) throw new Error('证据审阅范围与要求不匹配。');
          if (!matchingSource(record.kind, record.source)) throw new Error('证据来源与类型不匹配。');
          const artifact = await resolveProjectFile(options.project, criterion.artifact);
          if (await resolveProjectFile(options.project, record.artifact.path) !== artifact) throw new Error('证据对应其他产物路径。');
          if (await digest(artifact) !== record.artifact.sha256) throw new Error('实际产物内容摘要已变化，旧证据无效。');
          if (record.status === 'passed') {
            const corresponding = input.records.filter(value => matchingSource(value.kind, value.source) && (value.source === 'controlled-test') === (record.source === 'controlled-test')
              && value.requirement === record.requirement && value.criterion === record.criterion && value.kind === record.kind
              && value.artifact.sha256 === record.artifact.sha256 && sameScope(value.scope, record.scope));
            const latestTime = Math.max(...corresponding.map(value => Date.parse(value.provenance.observedAt)));
            const latest = corresponding.filter(value => Date.parse(value.provenance.observedAt) === latestTime);
            if (latest.some(value => value.status !== 'passed')) throw new Error('最新对应结论尚未通过，不能继承或复用更早的通过记录。');
          }
          const reusedFrom = [];
          const visited = new Set([record.id]);
          let current = record;
          while (current.reuseOf) {
            if (visited.has(current.reuseOf)) throw new Error('证据复用关联存在循环。');
            const origin = input.records.find(value => value.id === current.reuseOf);
            if (!origin) throw new Error(`复用原证据不存在：${current.reuseOf}`);
            if (origin.status !== 'passed') throw new Error(`复用原证据未通过：${origin.id}`);
            if (origin.requirement !== record.requirement || origin.criterion !== record.criterion || origin.kind !== record.kind) throw new Error('复用原证据对应其他要求、子项或类型。');
            if (origin.artifact.sha256 !== record.artifact.sha256 || !sameScope(origin.scope, record.scope)) throw new Error('复用原证据的内容或审阅范围已变化。');
            if (origin.source !== record.source || origin.provenance.actor !== record.provenance.actor || origin.provenance.record !== record.provenance.record || origin.provenance.observedAt !== record.provenance.observedAt) throw new Error('复用记录必须保留原证据来源与证明指针。');
            reusedFrom.push(origin.id);
            visited.add(origin.id);
            current = origin;
          }
          /** @type {import('./common.mjs').Status} */
          const status = record.status === 'denied' ? 'failed' : record.status;
          requiredChecks.push({ id, status, path: artifact, evidenceId: record.id, kind: record.kind, scope: record.scope, source: record.source, provenance: record.provenance, reusedFrom,
            message: status === 'passed' ? '产物内容、审阅版本与范围对应；结论取自证据记录声明。' : `证据结论为 ${record.status}，该子项未通过。` });
        } catch (error) { requiredChecks.push(failure(id, error instanceof Error ? error.message : String(error), document)); }
      }
      const status = statusOf(requiredChecks);
      requirements.push({ id: requirement.id, text: requirement.text, classifiedBy: requirement.classifiedBy, status, earned: status === 'passed', controlledTest,
        writeBackAllowed: status === 'passed' && !controlledTest, evidenceIds });
      checks.push(...requiredChecks);
    }
    return { command: 'evidence', status: statusOf(checks), checks,
      details: { document, reviewVersion: input.reviewVersion, requirements, scope: '仅核对声明的分类、结论与实际内容/版本/范围对应；不自动判断审美或证明声明者权限，不改写原始记录或事项。' } };
  } catch (error) {
    return { command: 'evidence', status: 'failed', checks: [failure('evidence-input', error instanceof Error ? error.message : String(error), document)] };
  }
}
