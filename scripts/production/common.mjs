import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { productionSchema } from './schema.mjs';

/** @typedef {{project:string, manifest:string, report:string, args:string[],output?:string,archive?:string}} CommandOptions */
/** @typedef {'passed'|'failed'|'pending'|'skipped'} Status */
/** @typedef {{id:string,status:Status,message:string,path?:string,[key:string]:unknown}} Check */
/** @typedef {{status:Status,command:string,checks:Check[],details?:unknown,affected?:unknown,[key:string]:unknown}} CommandResult */

/** @param {string} root @param {string} file */
function within(root, file) {
  const location = relative(root, file);
  return location !== '..' && !location.startsWith('../') && !isAbsolute(location);
}
/** 项目引用仅允许普通文件，符号链接的最终目标也必须属于项目。
 * @param {string} project @param {string} input */
export async function resolveProjectFile(project, input) {
  if (!input || isAbsolute(input) || input.includes('\0')) throw new Error(`引用必须是项目相对路径：${input}`);
  const root = await realpath(project);
  const candidate = resolve(root, input);
  if (!within(root, candidate)) throw new Error(`引用越出项目：${input}`);
  const target = await realpath(candidate);
  if (!within(root, target)) throw new Error(`引用目标越出项目：${input}`);
  if (!(await stat(target)).isFile()) throw new Error(`引用不是普通文件：${input}`);
  return target;
}
/** @param {CommandOptions} options */
export async function readManifest(options) {
  const path = await resolveProjectFile(options.project, options.manifest);
  const input = JSON.parse(await readFile(path, 'utf8'));
  const manifest = productionSchema.parse(input);
  return { manifest, path };
}
/** @param {string} id @param {string} message @param {string} [path] @returns {Check} */
export function failure(id, message, path) { return { id, status: 'failed', message, ...(path ? { path } : {}) }; }
/** @param {Check[]} checks @returns {Status} */
export function statusOf(checks) {
  if (checks.length === 0 || checks.some(check => check.status === 'failed')) return 'failed';
  if (checks.some(check => check.status === 'pending')) return 'pending';
  if (checks.some(check => check.status === 'skipped')) return 'skipped';
  return checks.every(check => check.status === 'passed') ? 'passed' : 'failed';
}
