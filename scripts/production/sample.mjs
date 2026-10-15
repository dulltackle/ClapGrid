import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { readManifest, resolveProjectFile, failure, statusOf } from './common.mjs';
import { evaluateEvidence } from './evidence.mjs';

const exec = promisify(execFile);
const identity = z.string().min(1);
const asset = z.object({ path: identity, sha256: z.string().regex(/^[a-f0-9]{64}$/) });
const visualScope = z.array(z.string().regex(/^visual:.+/)).min(1).refine(values => new Set(values).size === values.length, '视觉范围不能重复');
const sampleSchema = z.object({ id: identity, mode: z.enum(['actual-project', 'controlled-test']), reviewVersion: identity, video: asset, plan: asset, scope: visualScope,
  representative: z.object({ materials: z.array(identity).min(1), motions: z.array(identity).min(1), transitions: z.array(identity).min(1) }),
  confirmation: z.object({ requirement: identity, videoCriterion: identity, planCriterion: identity }).refine(value => value.videoCriterion !== value.planCriterion, '样片和方案须分别关联证据子项'),
});
const excluded = ['其他画面', '领域准确性', '发音听审', '完整成片终审'];

/** @param {string} path */
async function digest(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}
/** @param {string[]} left @param {string[]} right */
function sameScope(left, right) { return left.length === right.length && left.every(item => right.includes(item)); }

/** @param {import('./common.mjs').CommandOptions} options @returns {Promise<import('./common.mjs').CommandResult>} */
export default async function sample(options) {
  /** @type {import('./common.mjs').Check[]} */
  const checks = [];
  let batchAllowed = false;
  /** @type {Record<string, unknown>} */
  const details = { batchAllowed, excluded };
  try {
    const { manifest } = await readManifest(options);
    if (!manifest.sample) return { command: 'sample', status: 'pending', checks: [{ id: 'sample-input', status: 'pending', message: '批量制作前需要代表性动态样片、采用方案与实际用户确认。' }], details };
    const input = sampleSchema.parse(manifest.sample);
    Object.assign(details, { sampleId: input.id, reviewVersion: input.reviewVersion, mode: input.mode, scope: input.scope, representative: input.representative });
    const video = await resolveProjectFile(options.project, input.video.path);
    const plan = await resolveProjectFile(options.project, input.plan.path);
    if (await digest(video) !== input.video.sha256 || await digest(plan) !== input.plan.sha256) throw new Error('样片或采用方案内容已变化；更新身份并重新判断受影响确认。');
    Object.assign(details, { video: input.video, plan: input.plan });
    checks.push({ id: 'sample-identities', status: 'passed', path: video, message: '样片与视觉方案的实际内容身份已核对。' });
    const probe = await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'json', video], { maxBuffer: 1024 * 1024 });
    if (probe.stderr.trim()) throw new Error(`样片视频探测出现解码错误 ${video}：${probe.stderr.trim()}`);
    const frames = Number(JSON.parse(probe.stdout).streams?.[0]?.nb_read_frames);
    if (!(frames > 1)) throw new Error('样片需要可解码的动态视频；静态图片或单帧不能代表主要运动与转场。');
    const decode = await exec('ffmpeg', ['-v', 'error', '-xerror', '-nostdin', '-i', video, '-map', '0:v:0', '-f', 'null', '-'], { maxBuffer: 1024 * 1024 });
    if (decode.stderr.trim()) throw new Error(`样片视频完整解码出现错误 ${video}：${decode.stderr.trim()}`);
    checks.push({ id: 'sample-video', status: 'passed', path: video, frames, message: '动态视频完整解码通过；代表性与视觉效果仍由用户实际审阅。' });
    const evidence = await evaluateEvidence(options);
    if (evidence.inputError) throw new Error(`无法核对样片确认记录：${evidence.inputError.message}`);
    if (evidence.reviewVersion !== input.reviewVersion) throw new Error('样片与证据审阅版本不匹配。');
    const direction = evidence.requirements.find(requirement => requirement.id === input.confirmation.requirement);
    if (!direction) throw new Error('缺少样片视觉方向对应的验收要求。');
    checks.push({ id: 'sample-direction', status: direction.status, message: direction.status === 'passed' ? '对应要求的全部必需证据机械完整。' : '视觉方向尚未通过，保持待审或待修改。' });
    const confirmations = [];
    let actualUser = true;
    for (const [criterion, artifact] of [[input.confirmation.videoCriterion, video], [input.confirmation.planCriterion, plan]]) {
      const expected = direction.criteria.find(item => item.id === criterion);
      if (!expected) throw new Error(`样片或方案证据子项缺失或标识不唯一：${criterion}`);
      checks.push({ id: `${direction.id}:${expected.id}`, status: expected.status, path: expected.path, ...expected.proof, message: expected.message });
      if (expected.status !== 'passed') { actualUser = false; continue; }
      const proof = expected.proof;
      if (!proof || proof.kind !== 'user' || proof.path !== artifact || !sameScope(proof.scope, input.scope)) throw new Error('视觉确认必须对应样片与采用方案及相同的视觉审阅范围。');
      actualUser &&= proof.source === 'user-confirmation';
      confirmations.push({ evidenceId: proof.evidenceId, source: proof.source, provenance: proof.provenance, reusedFrom: proof.reusedFrom });
    }
    if (confirmations.length === 2 && JSON.stringify(confirmations[0]?.provenance) !== JSON.stringify(confirmations[1]?.provenance)) throw new Error('样片与采用方案应关联同一实际用户确认来源。');
    Object.assign(details, { confirmations, mechanicalEvidenceComplete: direction.status === 'passed' });
    batchAllowed = statusOf(checks) === 'passed' && actualUser && !direction.controlledTest && input.mode === 'actual-project';
    checks.push({ id: 'batch-permission', status: batchAllowed ? 'passed' : 'pending', message: batchAllowed ? '允许按已确认视觉方案及范围批量制作；其它画面与完整终审继续待审。' : '未取得可用于实际项目的用户视觉方向确认；受控测试不授予批量制作许可。' });
  } catch (error) { checks.push(failure('sample-input', error instanceof Error ? error.message : String(error))); }
  details.batchAllowed = batchAllowed;
  return { command: 'sample', status: statusOf(checks), checks, details };
}
