import { mkdir, writeFile, readFile, realpath, stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname, basename, relative, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { statusOf, failure, resolveProjectFile } from './production/common.mjs';

/** 已有文件及父目录按真实路径比较；尚未生成的输出保留其路径末段。
 * @param {string} path @returns {Promise<string>} */
async function canonicalPath(path) {
  try { return await realpath(path); }
  catch (error) {
    if (!(error instanceof Error) || !('code' in error) || !['ENOENT', 'ENOTDIR'].includes(String(error.code))) throw error;
    const parent = dirname(path);
    return parent === path ? path : resolve(await canonicalPath(parent), basename(path));
  }
}

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
  const protectedPaths = new Set([resolve(options.project, options.manifest), resolve(options.project, 'video.md'), ...(options.output ? [options.output] : []), ...(options.archive ? [options.archive] : [])]);
  let exclusiveReport = false;
  /** @param {string} target */
  const reportConflicts = async target => {
    if (protectedPaths.has(target)) return true;
    const canonical = await canonicalPath(target);
    return (await Promise.all([...protectedPaths].map(canonicalPath))).includes(canonical);
  };
  try {
    if (parseError) throw new Error(parseError);
    if (!options.project) throw new Error('必须指定 --project <项目根目录>');
    /** @param {unknown} value @param {boolean} [evidenceOnly] */
    const collectPaths = (value, evidenceOnly = false) => {
      if (!value || typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) {
        const pathKeys = evidenceOnly ? ['path', 'artifact'] : ['path', 'card', 'source', 'audio', 'assembly', 'review', 'typecheck', 'evidence', 'lastFrame'];
        if (typeof item === 'string' && pathKeys.includes(key)) protectedPaths.add(resolve(options.project, item));
        else if (!evidenceOnly && ['assets', 'transitions'].includes(key) && Array.isArray(item)) {
          for (const path of item) if (typeof path === 'string') protectedPaths.add(resolve(options.project, path));
          collectPaths(item, evidenceOnly);
        } else if (typeof item === 'object') collectPaths(item, evidenceOnly);
      }
    };
    /** 仅将能定位为项目内普通文件的证明指针加入保护；不认证其声明内容。
     * @param {unknown} value @returns {Promise<void>} */
    const collectProofs = async value => {
      if (!value || typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) {
        if (key === 'provenance' && item && typeof item === 'object' && 'record' in item && typeof item.record === 'string') {
          try {
            const pointer = item.record.startsWith('file:') ? fileURLToPath(item.record) : item.record;
            if (isAbsolute(pointer) || !/^[a-z][a-z0-9+.-]*:/i.test(pointer)) {
              const candidate = resolve(options.project, pointer);
              const actual = await resolveProjectFile(options.project, relative(options.project, candidate));
              protectedPaths.add(candidate);
              protectedPaths.add(actual);
            }
          } catch { /* 非文件指针由调用者核对原件；路径保护不判断证据真实性。 */ }
        } else if (item && typeof item === 'object') await collectProofs(item);
      }
    };
    try {
      const manifest = JSON.parse(await readFile(resolve(options.project, options.manifest), 'utf8'));
      collectPaths(manifest);
      if (typeof manifest.evidence === 'string') {
        try {
          const evidencePath = await resolveProjectFile(options.project, manifest.evidence);
          const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
          collectPaths(evidence, true);
          await collectProofs(evidence);
        } catch { /* 所属命令校验缺失或无效记录；可读记录的关联文件提前保护。 */ }
      }
    } catch {}
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
