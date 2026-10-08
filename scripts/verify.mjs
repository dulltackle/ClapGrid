import { mkdirSync, mkdtempSync, readFileSync, readdirSync, lstatSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { git, sourceIdentity, sameSource } from './check-source.mjs';
import { runLogged } from './check-runner.mjs';

/** 独立 Git 检出不共享工作区或 node_modules；日志和失败现场保留供复核。 */
export async function verify(root, revision, outputRoot = join(root, 'logs/verify')) {
  if (!revision) throw Error('正式验收必须指定 --revision <提交>');
  const commit = git(root, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]);
  mkdirSync(outputRoot, { recursive: true });
  const directory = mkdtempSync(join(outputRoot, 'run-'));
  const checkout = join(directory, 'source');
  const summary = { mode: 'verification', commit, checkout, directory, startedAt: new Date().toISOString(), node: process.version, status: 'running', results: [] };
  const save = () => writeFileSync(join(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`正式验收日志：${directory}`); save();
  try {
    git(root, ['clone', '--quiet', '--no-checkout', '--no-hardlinks', '--', root, checkout]);
    git(checkout, ['checkout', '--quiet', '--detach', commit]);
    for (const entry of git(checkout, ['ls-files', '--stage', '-z']).split('\0').filter(Boolean)) {
      if (entry.startsWith('120000 ') || entry.startsWith('160000 ')) throw Error('正式验收暂不支持源码符号链接或子模块');
    }
    summary.source = sourceIdentity(checkout);
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const install = await runLogged(npm, ['ci'], checkout, join(directory, 'install.log'));
    summary.results.push({ name: 'install', ...install }); save();
    if (install.status !== 'passed') throw Error('锁定依赖安装失败');
    if (!sameSource(summary.source, sourceIdentity(checkout))) throw Error('依赖安装改变了受验源码');
    const result = await runLogged(npm, ['run', 'check'], checkout, join(directory, 'check.log'));
    summary.results.push({ name: 'check', ...result });
    const checks = join(checkout, 'logs/check');
    const runs = readdirSync(checks).filter(name => lstatSync(join(checks, name)).isDirectory());
    if (runs.length !== 1) throw Error('正式验收需要唯一一份项目检查记录');
    summary.checkSummary = join(checks, runs[0], 'summary.json');
    const check = JSON.parse(readFileSync(summary.checkSummary, 'utf8'));
    summary.sourceAfter = sourceIdentity(checkout);
    if (!sameSource(summary.source, summary.sourceAfter) || summary.sourceAfter.dirty || !check.source || !check.sourceAfter || !sameSource(summary.source, check.source) || !sameSource(summary.source, check.sourceAfter)) throw Error('受验源码或项目检查证据发生变化');
    if (result.status !== 'passed' || check.status !== 'passed' || check.pending?.length !== 0 || !Array.isArray(check.results) || check.results.length !== 3 || !['typecheck', 'test', 'build'].every(name => check.results.some(step => step.name === name && step.status === 'passed' && step.exitCode === 0))) throw Error('项目检查未全部通过');
    summary.status = 'passed';
  } catch (error) { summary.status = 'failed'; summary.error = String(error); }
  summary.completedAt = new Date().toISOString(); save();
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { revision: { type: 'string' } } });
  const result = await verify(fileURLToPath(new URL('../', import.meta.url)), values.revision);
  process.exitCode = result.status === 'passed' ? 0 : 1;
}
