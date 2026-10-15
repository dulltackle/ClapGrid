import { failure } from './common.mjs';

/** 将业务核对结果转换为既有 v1 命令报告；拼接检查标识只用于展示。
 * @param {import('./evidence.mjs').EvidenceResult} result
 * @returns {import('./common.mjs').CommandResult} */
export function evidenceReport(result) {
  if (result.inputError) return { command: 'evidence', status: 'failed', checks: [failure('evidence-input', result.inputError.message, result.inputError.path)] };
  const checks = result.requirements.flatMap(requirement => requirement.criteria.map(criterion => ({
    id: `${requirement.id}:${criterion.id}`, status: criterion.status, path: criterion.path,
    ...criterion.proof,
    ...(criterion.previousStatus ? { previousStatus: criterion.previousStatus, dependencyAffected: true } : {}),
    message: criterion.message,
  })));
  const requirements = result.requirements.map(({ criteria, ...requirement }) => requirement);
  return { command: 'evidence', status: result.status, checks,
    details: { document: result.document, reviewVersion: result.reviewVersion, requirements,
      scope: '仅核对声明的分类、结论与实际内容/版本/范围对应；不自动判断审美或证明声明者权限，不改写原始记录或事项。' } };
}
