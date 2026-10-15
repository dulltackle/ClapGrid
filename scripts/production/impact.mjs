import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { dependencySchema } from './dependencies-schema.mjs';
import { readManifest, resolveProjectFile, failure, statusOf } from './common.mjs';
import { evaluateEvidence, recheckEvidence, evidenceReport } from './evidence.mjs';

const outputKinds = new Set(['assembly', 'review', 'last-frame', 'transition']);
/** @param {string} path */
async function digest(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}

/** @param {import('./dependencies-schema.mjs').DependencyGraph} graph */
function validateEdges(graph) {
  if (!graph.complete) throw new Error('依赖完整性未声明为 complete:true');
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  if (byId.size !== graph.nodes.length) throw new Error('依赖节点稳定 ID 重复');
  for (const node of graph.nodes) {
    if (new Set(node.dependsOn).size !== node.dependsOn.length) throw new Error(`${node.id} 的依赖 ID 重复`);
    for (const id of node.dependsOn) if (!byId.has(id)) throw new Error(`${node.id} 引用未登记依赖 ${id}`);
  }
  const visiting = new Set(), visited = new Set();
  /** @param {string} id @param {string[]} chain */
  const visit = (id, chain) => {
    if (visiting.has(id)) throw new Error(`依赖存在循环：${[...chain, id].join(' -> ')}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const input of byId.get(id)?.dependsOn ?? []) visit(input, [...chain, id]);
    visiting.delete(id); visited.add(id);
  };
  graph.nodes.forEach(node => visit(node.id, []));
  return byId;
}

/** @param {import('./common.mjs').CommandOptions} options
 * @param {import('./schema.mjs').ProductionManifest} manifest
 * @param {import('./dependencies-schema.mjs').DependencyGraph} graph
 * @param {Map<string,import('./dependencies-schema.mjs').DependencyNode>} byId */
async function validateCoverage(options, manifest, graph, byId) {
  /** @type {Map<string,import('./dependencies-schema.mjs').DependencyNode>} */
  const byPath = new Map();
  const segmentIds = new Set(manifest.segments.map(segment => segment.id));
  for (const node of graph.nodes) {
    const path = await resolveProjectFile(options.project, node.path);
    if (byPath.has(path)) throw new Error(`依赖文件重复登记：${node.path}`);
    byPath.set(path, node);
    if (node.segmentId && !segmentIds.has(node.segmentId)) throw new Error(`${node.id} 对应未知稳定片段 ${node.segmentId}`);
    if (outputKinds.has(node.kind) && (!node.segmentId || !node.dependsOn.length)) throw new Error(`${node.id} 生产输出缺少稳定片段身份或实际输入依赖`);
  }
  /** @param {string} consumer @param {string} input @returns {boolean} */
  const consumes = (consumer, input) => (byId.get(consumer)?.dependsOn ?? []).some(id => id === input || consumes(id, input));
  /** @param {string} consumer @param {string} input */
  const requireInput = (consumer, input) => {
    if (!consumes(consumer, input)) throw new Error(`${consumer} 未登记实际制作输入 ${input} 的关联`);
  };
  for (const segment of manifest.segments) {
    /** @type {Record<string,import('./dependencies-schema.mjs').DependencyNode>} */
    const roles = {};
    for (const role of /** @type {const} */ (['source', 'card', 'audio', 'assembly', 'review'])) {
      const node = byPath.get(await resolveProjectFile(options.project, segment[role]));
      if (!node || node.kind !== role || (node.segmentId && node.segmentId !== segment.id)) throw new Error(`${segment.id} 的 ${role} 缺少对应依赖映射：${segment[role]}`);
      if (outputKinds.has(role) && node.segmentId !== segment.id) throw new Error(`${node.id} 缺少片段 ${segment.id} 的稳定输出身份`);
      roles[role] = node;
    }
    if (!roles.assembly || !roles.review || !roles.source || !roles.audio) throw new Error(`${segment.id} 映射不完整`);
    requireInput(roles.assembly.id, roles.source.id);
    requireInput(roles.review.id, roles.assembly.id); requireInput(roles.review.id, roles.audio.id);
    if (segment.assets !== undefined) {
      if (!Array.isArray(segment.assets) || !segment.assets.every(path => typeof path === 'string')) throw new Error(`${segment.id} 的 assets 必须是实际使用的路径列表`);
      for (const path of segment.assets) {
        const node = byPath.get(await resolveProjectFile(options.project, path));
        if (!node || node.kind !== 'asset') throw new Error(`${segment.id} 素材未登记：${path}`);
        requireInput(roles.assembly.id, node.id);
      }
    }
    /** @type {{path:string,kind:string}[]} */
    const declaredOutputs = [];
    if (segment.lastFrame !== undefined) {
      if (typeof segment.lastFrame !== 'string') throw new Error(`${segment.id} 的 lastFrame 必须是实际末帧路径`);
      declaredOutputs.push({ path: segment.lastFrame, kind: 'last-frame' });
    }
    if (segment.transitions !== undefined) {
      if (!Array.isArray(segment.transitions) || !segment.transitions.every(path => typeof path === 'string')) throw new Error(`${segment.id} 的 transitions 必须是实际转场路径列表`);
      declaredOutputs.push(...segment.transitions.map(path => ({ path, kind: 'transition' })));
    }
    for (const output of declaredOutputs) {
      const node = byPath.get(await resolveProjectFile(options.project, output.path));
      if (!node || node.kind !== output.kind || node.segmentId !== segment.id) throw new Error(`${segment.id} 的 ${output.kind} 缺少对应依赖记录：${output.path}`);
    }
    for (const node of graph.nodes.filter(node => node.segmentId === segment.id)) {
      if (node.kind === 'last-frame') requireInput(node.id, roles.assembly.id);
      if (node.kind === 'transition') requireInput(roles.assembly.id, node.id);
    }
  }
}

/** @param {import('./common.mjs').CommandOptions} options @returns {Promise<import('./common.mjs').CommandResult>} */
export default async function impact(options) {
  try {
    const { manifest } = await readManifest(options);
    const graph = dependencySchema.parse(manifest.dependencies);
    const byId = validateEdges(graph);
    await validateCoverage(options, manifest, graph, byId);
    /** @type {import('./common.mjs').Check[]} */
    const checks = [{ id: 'dependencies', status: 'passed', message: '依赖清单结构已读取' }];
    const identities = [];
    for (const node of graph.nodes) {
      const path = await resolveProjectFile(options.project, node.path);
      const sha256 = await digest(path);
      identities.push({ ...node, sha256, baselineSha256: node.sha256, changed: sha256 !== node.sha256 });
      checks.push({ id: `dependency:${node.id}`, status: 'passed', message: '实际项目文件已读取并流式核对摘要', path: node.path });
    }
    /** @type {{id:string, targets:string[], before?:unknown, after?:unknown}[]} */
    const configurationChanges = [];
    const allOutputs = graph.nodes.filter(node => outputKinds.has(node.kind)).map(node => node.id);
    const baseline = graph.renderInputs;
    if (!baseline) {
      checks.push({ id: 'render-input-baseline', status: 'pending', message: '缺少 renderInputs 渲染参数基线，需补齐或扩大全部画面输出核对范围' });
      configurationChanges.push({ id: 'render:baseline-missing', targets: allOutputs });
    } else {
      const currentProject = { width: manifest.project.width, height: manifest.project.height, fps: manifest.project.fps };
      const previousProject = { width: baseline.width, height: baseline.height, fps: baseline.fps };
      if (JSON.stringify(currentProject) !== JSON.stringify(previousProject)) configurationChanges.push({ id: 'render:project', targets: allOutputs, before: previousProject, after: currentProject });
      if (new Set(baseline.segments.map(segment => segment.id)).size !== baseline.segments.length) throw new Error('renderInputs 片段稳定身份重复');
      if (JSON.stringify(baseline.segments.map(segment => segment.id)) !== JSON.stringify(manifest.segments.map(segment => segment.id))) {
        configurationChanges.push({ id: 'render:segment-order', targets: allOutputs, before: baseline.segments, after: manifest.segments.map(segment => ({ id: segment.id, frames: segment.frames })) });
      } else {
        for (const segment of manifest.segments) {
          const original = baseline.segments.find(value => value.id === segment.id);
          if (original?.frames !== segment.frames) configurationChanges.push({ id: `render:${segment.id}:frames`, targets: graph.nodes.filter(node => node.segmentId === segment.id && outputKinds.has(node.kind)).map(node => node.id), before: original?.frames, after: segment.frames });
        }
      }
      checks.push({ id: 'render-input-baseline', status: 'passed', message: '已核对尺寸、帧率、稳定片段顺序及帧长的已知渲染输入基线' });
    }
    /** @type {Map<string,string[][]>} */
    const reasons = new Map();
    const roots = [...identities.filter(node => node.changed).map(node => ({ id: node.id, targets: [node.id] })), ...configurationChanges];
    for (const root of roots) {
      const visited = new Set(root.targets);
      const queue = root.targets.map(id => ({ id, chain: root.id === id ? [id] : [root.id, id] }));
      while (queue.length) {
        const current = queue.shift();
        if (!current) break;
        reasons.set(current.id, [...(reasons.get(current.id) ?? []), current.chain]);
        for (const consumer of graph.nodes.filter(node => node.dependsOn.includes(current.id))) {
          if (visited.has(consumer.id)) continue;
          visited.add(consumer.id); queue.push({ id: consumer.id, chain: [...current.chain, consumer.id] });
        }
      }
    }
    const affected = identities.filter(node => reasons.has(node.id)).map(node => {
      const reasonChains = reasons.get(node.id) ?? [];
      return { ...node, causeIds: reasonChains.map(chain => chain[0]), reasonChains,
        relation: node.changed ? 'changed' : reasonChains.some(chain => chain.length === 2) ? 'direct' : 'indirect' };
    });
    const outputs = affected.filter(node => outputKinds.has(node.kind));
    for (const node of outputs) checks.push({ id: `affected:${node.id}`, status: 'pending', path: node.path,
      message: `受影响输出需重制或重新核对来源与确认：${node.reasonChains.map(chain => chain.join(' -> ')).join('；')}` });
    let evidence;
    if (manifest.evidence !== undefined) {
      const original = await evaluateEvidence(options);
      const affectedArtifacts = await Promise.all(affected.map(async node => ({ path: await resolveProjectFile(options.project, node.path), causeIds: node.causeIds.filter(id => id !== undefined), reasonChains: node.reasonChains })));
      const rechecked = recheckEvidence(original, affectedArtifacts);
      const evidenceChecks = evidenceReport(rechecked).checks;
      const criteria = rechecked.requirements.flatMap(requirement => requirement.criteria);
      checks.push(...evidenceChecks.map(check => ({ ...check, id: `evidence:${check.id}` })));
      evidence = { status: rechecked.status, checks: evidenceChecks,
        needsReview: criteria.filter(criterion => criterion.previousStatus && criterion.proof).map(criterion => criterion.proof?.evidenceId),
        unchangedProofs: criteria.filter(criterion => criterion.status === 'passed' && criterion.proof).map(criterion => ({ evidenceId: criterion.proof?.evidenceId, path: criterion.proof?.path, scope: criterion.proof?.scope, source: criterion.proof?.source, reusedFrom: criterion.proof?.reusedFrom })),
        scope: '复用现有 evidence 核对；受影响输入重新判断旧确认，无关且内容/范围匹配的证据保持原有效性，不改写原件。' };
    } else {
      evidence = { status: 'pending', checks: [], needsReview: [], scope: '项目未提供 evidence 记录，未执行确认对应检查，不能声明人工确认通过。' };
    }
    return { command: 'impact', status: statusOf(checks), checks,
      affected: { complete: Boolean(baseline), nodes: affected, outputs, segments: [...new Set(outputs.map(node => node.segmentId).filter(Boolean))].sort() },
      details: { evidence, configurationChanges, unchanged: identities.filter(node => !reasons.has(node.id)), changed: identities.filter(node => node.changed), actualHost: 'pending', validSpeech: 'pending', fullExport: 'pending', scope: '只读制作依赖核对；受影响输出不能沿用旧有效声明。文件字节未变不能代替有效配音或实际宿主导出验收。' } };
  } catch (error) { return { command: 'impact', status: 'failed', affected: { complete: false, requiresExpandedScope: true },
    checks: [failure('dependencies-input', `${error instanceof Error ? error.message : String(error)}；补齐实际依赖或扩大核对范围，不能声明旧输出仍有效。`, options.manifest)] }; }
}
