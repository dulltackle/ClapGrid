import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readManifest, resolveProjectFile, statusOf } from './common.mjs';

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

/** @typedef {z.infer<typeof recordSchema>} EvidenceRecord */
/** @typedef {z.infer<typeof requirementSchema>} EvidenceRequirement */
/** @typedef {{path:string,evidenceId:string,kind:EvidenceRecord['kind'],scope:string[],source:EvidenceRecord['source'],provenance:EvidenceRecord['provenance'],reusedFrom:string[]}} EvidenceProof */
/** @typedef {{path:string,causeIds:string[],reasonChains:string[][]}} EvidenceDependencyImpact */
/** 子项的声明、所选记录和机械核对结论分别保留；proof 仅在完整对应核对后提供。
 * @typedef {{id:string,requirementId:string,kind:EvidenceRecord['kind'],artifact:string,scope:string[],status:import('./common.mjs').Status,message:string,path?:string,evidence?:EvidenceRecord,proof?:EvidenceProof,previousStatus?:import('./common.mjs').Status,dependencyImpact?:EvidenceDependencyImpact}} EvidenceCriterionResult */
/** @typedef {{id:string,text?:string,classifiedBy:EvidenceRequirement['classifiedBy'],criteria:EvidenceCriterionResult[],status:import('./common.mjs').Status,earned:boolean,controlledTest:boolean,writeBackAllowed:boolean,evidenceIds:string[]}} EvidenceRequirementResult */
/** @typedef {{status:import('./common.mjs').Status,document?:string,reviewVersion?:string,requirements:EvidenceRequirementResult[],inputError?:{message:string,path?:string}}} EvidenceResult */

export { evidenceReport } from './evidence-report.mjs';
import { evidenceReport } from './evidence-report.mjs';

/** @param {Pick<EvidenceRequirement,'id'|'text'|'classifiedBy'>} requirement
 * @param {EvidenceCriterionResult[]} criteria @returns {EvidenceRequirementResult} */
function summarizeRequirement(requirement, criteria) {
  const status = statusOf(criteria);
  const controlledTest = criteria.some(criterion => criterion.evidence?.source === 'controlled-test');
  return { id: requirement.id, text: requirement.text, classifiedBy: requirement.classifiedBy, criteria, status, earned: status === 'passed', controlledTest,
    writeBackAllowed: status === 'passed' && !controlledTest, evidenceIds: criteria.flatMap(criterion => criterion.evidence ? [criterion.evidence.id] : []) };
}

/** 对已核对结果应用明确的产物影响；不读取依赖图，也不修改原结果或传入的原因。
 * @param {EvidenceResult} original @param {EvidenceDependencyImpact[]} affectedArtifacts @returns {EvidenceResult} */
export function recheckEvidence(original, affectedArtifacts) {
  const result = structuredClone(original);
  const byPath = new Map(affectedArtifacts.map(impact => [impact.path, impact]));
  for (const requirement of result.requirements) {
    for (const criterion of requirement.criteria) {
      const impact = criterion.path ? byPath.get(criterion.path) : undefined;
      if (!impact) continue;
      criterion.dependencyImpact = structuredClone(impact);
      if (criterion.status !== 'passed') continue;
      criterion.previousStatus = criterion.status;
      criterion.status = 'pending';
      criterion.message = '对应产物的制作输入或依赖已变化，旧确认需重新核对；当前输出字节未变不能证明仍有效。';
    }
  }
  result.requirements = result.requirements.map(requirement => summarizeRequirement(requirement, requirement.criteria));
  result.status = statusOf(result.requirements);
  return result;
}

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

/** 只读核对证据的公开业务入口，不包含依赖传播或展示检查标识。
 * @param {import('./common.mjs').CommandOptions} options @returns {Promise<EvidenceResult>} */
export async function evaluateEvidence(options) {
  let document;
  try {
    const { manifest } = await readManifest(options);
    if (typeof manifest.evidence !== 'string') throw new Error('清单 evidence 必须指向项目内审阅记录 JSON。');
    document = await resolveProjectFile(options.project, manifest.evidence);
    const input = evidenceSchema.parse(JSON.parse(await readFile(document, 'utf8')));
    const requirementIds = input.requirements.map(value => value.id);
    const recordIds = input.records.map(value => value.id);
    if (new Set(requirementIds).size !== requirementIds.length || new Set(recordIds).size !== recordIds.length) throw new Error('要求或证据记录的稳定 ID 重复。');
    /** @type {EvidenceRequirementResult[]} */
    const requirements = [];
    for (const requirement of input.requirements) {
      if (new Set(requirement.required.map(value => value.id)).size !== requirement.required.length) throw new Error(`要求 ${requirement.id} 的子项 ID 重复。`);
      /** @type {EvidenceCriterionResult[]} */
      const criteria = [];
      for (const criterion of requirement.required) {
        /** @type {EvidenceCriterionResult} */
        const result = { ...criterion, requirementId: requirement.id, status: 'pending', path: document, message: '缺少对应证据，仍需执行或审阅。' };
        criteria.push(result);
        const records = input.records.filter(record => record.requirement === requirement.id && record.criterion === criterion.id);
        const candidates = records.filter(record => record.reviewVersion === input.reviewVersion);
        if (!candidates.length) {
          if (records.length) Object.assign(result, { status: 'failed', message: '证据属于其他审阅版本，不能自动继承通过。' });
          continue;
        }
        if (candidates.length !== 1) { Object.assign(result, { status: 'failed', message: '当前审阅版本有多个证据记录，需明确唯一对应记录。' }); continue; }
        const record = candidates[0];
        if (!record) continue;
        result.evidence = record;
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
          Object.assign(result, { status, path: artifact,
            message: status === 'passed' ? '产物内容、审阅版本与范围对应；结论取自证据记录声明。' : `证据结论为 ${record.status}，该子项未通过。` });
          result.proof = { path: artifact, evidenceId: record.id, kind: record.kind, scope: record.scope, source: record.source, provenance: record.provenance, reusedFrom };
        } catch (error) { Object.assign(result, { status: 'failed', message: error instanceof Error ? error.message : String(error) }); }
      }
      requirements.push(summarizeRequirement(requirement, criteria));
    }
    return { status: statusOf(requirements), document, reviewVersion: input.reviewVersion, requirements };
  } catch (error) {
    return { status: 'failed', requirements: [], inputError: { message: error instanceof Error ? error.message : String(error), path: document } };
  }
}

/** @param {import('./common.mjs').CommandOptions} options @returns {Promise<import('./common.mjs').CommandResult>} */
export default async function evidence(options) {
  return evidenceReport(await evaluateEvidence(options));
}
