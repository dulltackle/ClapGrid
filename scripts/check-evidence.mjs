import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJson } from './check-lifecycle.mjs';
import { sameSource } from './check-source.mjs';
import { digest, executionIdentity, validateExecution } from './test-evidence.mjs';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const sameSet = (a, b) => new Set(a).size === a.length && a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);
const sameIdentity = (a, b) => a.executionId === b.executionId && sameSource(a.source, b.source) && JSON.stringify(a.config) === JSON.stringify(b.config) && JSON.stringify(a.environment) === JSON.stringify(b.environment);

/** 不可变阶段证明保留真实命令、原始日志及各自 nonce；累计只引用它。 */
export function validateStageProof(root, reference, runId, current = executionIdentity(root)) {
  if (!reference?.path || digest(reference.path) !== reference.sha256) throw Error('累计阶段证明缺失或改变');
  const proof = read(reference.path), result = proof.result;
  if (proof.schemaVersion !== 1 || proof.runId !== runId || !runId || result.execution !== 'executed' || result.status !== 'passed' || result.exitCode !== 0
    || !result.startedAt || !result.completedAt || Date.parse(result.startedAt) > Date.parse(result.completedAt)
    || !sameIdentity(proof.identity, { ...current, executionId: proof.identity.executionId })) throw Error('累计阶段运行、源码、配置或环境身份不符');
  if (!result.log || digest(result.log) !== proof.logSha256) throw Error('累计原始阶段日志缺失或改变');
  if (result.testPlan) {
    if (!result.testReport || digest(result.testReport) !== proof.reportSha256 || result.testExecutionId !== proof.identity.executionId) throw Error('累计原测试报告缺失或改变');
    const report = read(result.testReport);
    validateExecution(root, report, result.testPlan, proof.identity, { strictFiles: result.strictTestFiles ?? [] });
    if (report.status !== 'passed') throw Error('累计来源未通过');
  }
  return proof;
}

function assemble(root, plan, stages, runId, current) {
  const actual = { files: [], cases: [] }, expected = { files: plan.files, cases: [], caseDiscovery: '同次原执行证据的文件与原生收集事件并集' };
  for (const origin of stages) {
    const proof = validateStageProof(root, origin.proof, runId, current);
    if (!proof.result.testPlan || !origin.files.length || !sameSet(origin.files, [...new Set(origin.files)]) || origin.files.some(file => !proof.result.testPlan.files.includes(file) || !plan.files.includes(file))) throw Error('累计来源范围越界或重复');
    const report = read(proof.result.testReport);
    actual.files.push(...report.actual.files.filter(item => origin.files.includes(item.file)));
    actual.cases.push(...report.actual.cases.filter(item => origin.files.includes(item.file)));
    expected.cases.push(...report.expected.cases.filter(item => origin.files.includes(item.file)));
  }
  if (!stages.length || !actual.cases.length || !sameSet(actual.files.map(item => item.file), plan.files)) throw Error('累计文件集合遗漏、重复或零收集');
  return { actual, expected, summary: { success: true, files: actual.files.length, cases: actual.cases.length } };
}

export function validateCumulativeEvidence(root, report, plan, runId, allowedProofs, current = executionIdentity(root)) {
  if (report.schemaVersion !== 1 || report.kind !== 'test-cumulative' || report.runId !== runId || !report.complete || report.status !== 'passed'
    || report.failures?.length || report.errors?.length || JSON.stringify(report.plan) !== JSON.stringify(plan)) throw Error('累计证据不完整或身份不符');
  const origins = report.sources?.stages;
  if (!Array.isArray(origins) || origins.some(item => !allowedProofs.some(ref => JSON.stringify(ref) === JSON.stringify(item.proof)))) throw Error('累计包含其他运行或未登记的阶段');
  const expected = assemble(root, plan, origins, runId, current);
  if (['actual', 'expected', 'summary'].some(key => JSON.stringify(report[key]) !== JSON.stringify(expected[key]))) throw Error('累计文件、用例或汇总与原始证据不符');
  return true;
}

/** 生命周期 context 私有持有此账本；新的独立命令始终创建空账本。 */
export class CheckEvidenceLedger {
  constructor(root, directory) {
    this.root = root; this.directory = directory; this.runId = randomUUID(); this.proofs = []; this.referenceFiles = new Set(); this.strictTestFiles = new Set();
  }
  remember(result, phase, identity) {
    if (result.status !== 'passed') return;
    const path = join(this.directory, `stage-proof-${this.proofs.length + 1}.json`);
    atomicJson(path, { schemaVersion: 1, runId: this.runId, phase, identity, result: { ...result, execution: 'executed' }, logSha256: digest(result.log), ...(result.testPlan ? { reportSha256: digest(result.testReport) } : {}) });
    const reference = { path, sha256: digest(path) };
    validateStageProof(this.root, reference, this.runId);
    this.proofs.push(reference);
    for (const file of result.strictTestFiles ?? []) this.strictTestFiles.add(file);
    for (const file of result.testPlan?.files ?? []) if (file.endsWith('.native.ts')) this.referenceFiles.add(file);
    return reference;
  }
  typecheck(current) {
    for (const reference of this.proofs) {
      const proof = validateStageProof(this.root, reference, this.runId, current);
      if (proof.result.name === 'typecheck') return { ...proof.result, execution: 'counted', countedAt: new Date().toISOString(), countedFrom: reference };
    }
  }
  selection(plan, current) {
    const seen = new Set(), origins = [];
    for (const reference of this.proofs) {
      const proof = validateStageProof(this.root, reference, this.runId, current);
      const files = (proof.result.testPlan?.files ?? []).filter(file => plan.files.includes(file) && !seen.has(file));
      if (files.length) { origins.push({ proof: reference, files }); files.forEach(file => seen.add(file)); }
    }
    return { origins, remaining: plan.files.filter(file => !seen.has(file)) };
  }
  complete(plan, origins, path) {
    const current = executionIdentity(this.root);
    const report = { schemaVersion: 1, kind: 'test-cumulative', runId: this.runId, plan, complete: true, status: 'passed', failures: [], errors: [], sources: { stages: origins }, ...assemble(this.root, plan, origins, this.runId, current) };
    validateCumulativeEvidence(this.root, report, plan, this.runId, this.proofs, current);
    atomicJson(path, report);
  }
}
