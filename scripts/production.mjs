import { mkdir, writeFile, readFile, realpath, stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { statusOf, failure, canonicalFilePath } from './production/common.mjs';
import { projectFileReferences } from './production/project-file-references.mjs';

/** 在命令产生输出前拒绝可预先识别的报告写入错误。
 * @param {string} target */
async function prepareReport(target) {
  let info;
  try { info = await stat(target); }
  catch (error) {
    if (!(error instanceof Error) || !('code' in error) || String(error.code) !== 'ENOENT') throw error;
  }
  if (info) {
    if (!info.isFile()) throw new Error('报告路径不是普通文件');
    const previous = JSON.parse(await readFile(target, 'utf8'));
    if (previous.report !== target || previous.schemaVersion !== 1 || !previous.startedAt || !Array.isArray(previous.checks)) throw new Error('报告路径指向已有项目输入，拒绝覆盖');
    await access(target, constants.W_OK);
  }
  await mkdir(dirname(target), { recursive: true });
  await access(dirname(target), constants.W_OK);
}

/** @param {string[]} argv */
export async function main(argv) {
  const startedAt = new Date().toISOString();
  const command = argv[0] ?? '';
  /** @type {import('./production/common.mjs').CommandOptions} */
  const options = { project: '', manifest: 'production.json', report: '', args: [] };
  /** @type {import('./production/common.mjs').CommandResult} */
  let result = { command, status: 'failed', checks: [] };
  let parseError;
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--') { options.args = argv.slice(index + 1); break; }
    if (flag === '--project' || flag === '--manifest' || flag === '--report' || flag === '--output' || flag === '--archive') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) { parseError = `参数缺少值：${flag}`; break; }
      if (flag === '--project') options.project = resolve(value);
      if (flag === '--manifest') options.manifest = value;
      if (flag === '--report') options.report = resolve(value);
      if (flag === '--output') options.output = value;
      if (flag === '--archive') options.archive = value;
    } else { parseError = `未知参数：${flag}`; break; }
  }
  if (options.output) options.output = resolve(options.project || process.cwd(), options.output);
  if (options.archive) options.archive = resolve(options.project || process.cwd(), options.archive);
  // 默认交付路径也必须在执行前参与报告覆盖保护。
  if (command === 'pack' && !options.output) options.output = resolve(options.project || process.cwd(), 'delivery.tar.gz');
  if (!options.report) options.report = resolve(options.project || process.cwd(), 'logs/production', `${startedAt.replaceAll(':', '-')}-${process.pid}.json`);
  const protectedPaths = await projectFileReferences(options, 'report-protection');
  let exclusiveReport = false;
  /** @param {string} target */
  const reportConflicts = async target => {
    if (protectedPaths.has(target)) return true;
    const canonical = await canonicalFilePath(target);
    if ((await Promise.all([...protectedPaths].map(canonicalFilePath))).includes(canonical)) return true;
    // 硬链接具有不同的真实路径；已有报告还须按实际文件身份保护输入原件。
    let targetInfo;
    try { targetInfo = await stat(target, { bigint: true }); }
    catch (error) {
      if (error instanceof Error && 'code' in error && ['ENOENT', 'ENOTDIR'].includes(String(error.code))) return false;
      throw error;
    }
    for (const path of protectedPaths) {
      try {
        const info = await stat(path, { bigint: true });
        if (info.dev === targetInfo.dev && info.ino === targetInfo.ino) return true;
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || !['ENOENT', 'ENOTDIR'].includes(String(error.code))) throw error;
      }
    }
    return false;
  };
  try {
    if (parseError) throw new Error(parseError);
    if (!options.project) throw new Error('必须指定 --project <项目根目录>');
    if (await reportConflicts(options.report)) {
      const requested = options.report;
      options.report = resolve(options.project, 'logs/production', `failure-${startedAt.replaceAll(':', '-')}-${process.pid}.json`);
      exclusiveReport = true;
      throw new Error(`报告路径属于项目输入或输出，拒绝覆盖：${requested}`);
    }
    try { await prepareReport(options.report); }
    catch (error) {
      const requested = options.report;
      options.report = resolve(options.project, 'logs/production', `failure-${startedAt.replaceAll(':', '-')}-${process.pid}.json`);
      exclusiveReport = true;
      throw new Error(`报告无法写入，命令尚未执行 ${requested}：${String(error)}`);
    }
    if (!['init', 'refs', 'check', 'evidence', 'sample', 'impact', 'pack', 'verify-package'].includes(command)) throw new Error('命令必须是 init、refs、check、evidence、sample、impact、pack 或 verify-package');
    const module = await import(`./production/${command}.mjs`);
    result = await module.default(options);
    if (result.status !== 'passed' && statusOf(result.checks) === 'passed') result.checks.push({ id: 'command-status', status: result.status, message: '命令报告尚未通过' });
    result.status = statusOf(result.checks);
  } catch (error) { result = { command, status: 'failed', checks: [failure('command', String(error))] }; }
  const report = { schemaVersion: 1, ...result, project: options.project, manifest: options.manifest, startedAt, finishedAt: new Date().toISOString(), report: options.report };
  try {
    if (await reportConflicts(options.report)) throw new Error('报告路径属于项目输入或输出，拒绝覆盖');
    // 报告不能覆盖清单及其中引用的生产输入；非 JSON 输入也受 existing-file 保护。
    let existing = false;
    try { await realpath(options.report); existing = true; } catch {}
    if (existing) {
      const previous = JSON.parse(await readFile(options.report, 'utf8'));
      if (previous.report !== options.report || previous.schemaVersion !== 1 || !previous.startedAt || !Array.isArray(previous.checks)) throw new Error('报告路径指向已有项目输入，拒绝覆盖');
    }
    await mkdir(dirname(options.report), { recursive: true });
    await writeFile(options.report, JSON.stringify(report, null, 2) + '\n', exclusiveReport ? { flag: 'wx' } : undefined);
  } catch (error) {
    report.checks.push(failure('report', `报告写入失败 ${options.report}：${String(error)}`, options.report));
    report.status = 'failed';
    report.report = resolve(options.project || process.cwd(), 'logs/production', `failure-${startedAt.replaceAll(':', '-')}-${process.pid}.json`);
    try {
      if (await reportConflicts(report.report)) throw new Error('备用报告路径属于项目输入或输出，拒绝覆盖');
      await mkdir(dirname(report.report), { recursive: true });
      await writeFile(report.report, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    } catch (fallbackError) { console.error(`failed：报告无法保存：${String(fallbackError)}`); return 1; }
  }
  const failures = report.checks.filter(check => check.status !== 'passed');
  console.log(`${command || 'production'}：${report.status}；检查 ${report.checks.length} 项；${failures.length} 项失败或未完成`);
  if (report.affected) console.log(`受影响范围：${JSON.stringify(report.affected)}`);
  for (const check of failures.slice(0, 3)) console.log(`${check.id}${check.path ? ` (${check.path})` : ''}：${check.message.slice(0, 240)}`);
  console.log(`完整报告：${report.report}`);
  return report.status === 'passed' ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2));
