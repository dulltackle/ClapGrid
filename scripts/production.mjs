import { mkdir, writeFile, readFile, realpath } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { statusOf, failure } from './production/common.mjs';

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
  try {
    if (parseError) throw new Error(parseError);
    if (!options.project) throw new Error('必须指定 --project <项目根目录>');
    const protectedPaths = new Set([resolve(options.project, options.manifest), resolve(options.project, 'video.md'), ...(options.output ? [options.output] : []), ...(options.archive ? [options.archive] : [])]);
    /** @param {unknown} value */
    const collectPaths = value => {
      if (!value || typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'string' && ['path', 'card', 'source', 'audio', 'assembly', 'review', 'typecheck', 'evidence'].includes(key)) protectedPaths.add(resolve(options.project, item));
        else if (typeof item === 'object') collectPaths(item);
      }
    };
    try { collectPaths(JSON.parse(await readFile(resolve(options.project, options.manifest), 'utf8'))); } catch {}
    if (protectedPaths.has(options.report)) {
      const requested = options.report;
      options.report = resolve(options.project, 'logs/production', `failure-${startedAt.replaceAll(':', '-')}-${process.pid}.json`);
      throw new Error(`报告路径属于项目输入或输出，拒绝覆盖：${requested}`);
    }
    if (!['init', 'refs', 'check', 'evidence', 'sample', 'impact', 'pack', 'verify-package'].includes(command)) throw new Error('命令必须是 init、refs、check、evidence、sample、impact、pack 或 verify-package');
    const module = await import(`./production/${command}.mjs`);
    result = await module.default(options);
    if (result.status !== 'passed' && statusOf(result.checks) === 'passed') result.checks.push({ id: 'command-status', status: result.status, message: '命令报告尚未通过' });
    result.status = statusOf(result.checks);
  } catch (error) { result = { command, status: 'failed', checks: [failure('command', String(error))] }; }
  const report = { schemaVersion: 1, ...result, project: options.project, manifest: options.manifest, startedAt, finishedAt: new Date().toISOString(), report: options.report };
  try {
    // 报告不能覆盖清单及其中引用的生产输入；非 JSON 输入也受 existing-file 保护。
    let existing = false;
    try { await realpath(options.report); existing = true; } catch {}
    if (existing) {
      const previous = JSON.parse(await readFile(options.report, 'utf8'));
      if (previous.report !== options.report || previous.schemaVersion !== 1 || !previous.startedAt || !Array.isArray(previous.checks)) throw new Error('报告路径指向已有项目输入，拒绝覆盖');
    }
    await mkdir(dirname(options.report), { recursive: true });
    await writeFile(options.report, JSON.stringify(report, null, 2) + '\n');
  } catch (error) {
    report.checks.push(failure('report', `报告写入失败 ${options.report}：${String(error)}`, options.report));
    report.status = 'failed';
    report.report = resolve(options.project || process.cwd(), 'logs/production', `failure-${startedAt.replaceAll(':', '-')}-${process.pid}.json`);
    try {
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
