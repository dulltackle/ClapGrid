import { parseArgs } from 'node:util';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, readFile, writeFile, rename, lstat, realpath, rm } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { readPluginIdentity, pluginFingerprint } from './plugin-identity.mjs';
const exec = promisify(execFile);
const delay = ms => new Promise(r => setTimeout(r, ms));
const run = async (command, args, options = {}) => (await exec(command, args, { timeout: 120000, maxBuffer: 4 * 1024 * 1024, ...options })).stdout;
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const plainDirectory = async path => { const st = await lstat(path); if (!st.isDirectory() || st.isSymbolicLink()) throw Error('更新目录必须是普通目录：' + path); };
let report = { complete: false, installed: 'pending', service: 'pending', host: 'reload-required' };
let lock;
try {
  const { values: v } = parseArgs({ options: Object.fromEntries(['package', 'revision', 'marketplace-root', 'cache-root', 'workspace', 'thread', 'installer', 'backup-root'].map(k => [k, { type: 'string' }])) });
  for (const key of ['marketplace-root', 'cache-root', 'workspace', 'thread']) if (!v[key]) throw Error('缺少 --' + key);
  const market = await realpath(v['marketplace-root']);
  const catalog = JSON.parse(await readFile(join(market, '.agents/plugins/marketplace.json'), 'utf8'));
  const entries = catalog.plugins.filter(p => p.name === 'clapgrid');
  if (entries.length !== 1 || entries[0].source?.source !== 'local' || !/^[a-zA-Z0-9_-]+$/.test(catalog.name)) throw Error('需要唯一的本地 ClapGrid 市场条目');
  const source = resolve(market, entries[0].source.path);
  if (!relative(market, source) || relative(market, source).startsWith('..')) throw Error('插件源须位于指定市场中');
  await plainDirectory(source);
  if (await realpath(source) !== source) throw Error('插件源路径不能含符号链接');
  const oldManifest = JSON.parse(await readFile(join(source, '.codex-plugin/plugin.json'), 'utf8'));
  if (oldManifest.name !== 'clapgrid' || !/^[a-zA-Z0-9.+_-]+$/.test(oldManifest.version)) throw Error('插件源身份无效');
  const cache = resolve(v['cache-root']);
  const stateDir = join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'clapgrid');
  await mkdir(stateDir, { recursive: true });
  const lockPath = join(stateDir, 'plugin-update.lock');
  await mkdir(lockPath); lock = lockPath;
  const targetFile = join(stateDir, 'plugin-update.json');
  if (!v.package) {
    if (!v.revision) throw Error('从源码更新需要 --revision，且工作区必须干净');
    const head = (await run('git', ['rev-parse', 'HEAD'])).trim();
    const expected = (await run('git', ['rev-parse', v.revision + '^{commit}'])).trim();
    if (head !== expected || (await run('git', ['status', '--porcelain'])).trim()) throw Error('当前源码与指定提交不一致或存在未提交修改');
    await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'plugin:build']);
  }
  const pkg = await realpath(v.package || 'dist/plugin/clapgrid');
  const identity = await readPluginIdentity(pkg);
  if (identity.state !== 'known') throw Error('目标插件包未通过内容指纹验证');
  if (v.revision && identity.source.commit !== (await run('git', ['rev-parse', v.revision + '^{commit}'])).trim()) throw Error('目标包不属于指定提交');
  const destination = join(cache, catalog.name, 'clapgrid', identity.version);
  const previousInstalled = join(cache, catalog.name, 'clapgrid', oldManifest.version);
  const runtime = async (directory, action, allowOffline = false) => JSON.parse(await run(process.execPath, [join(directory, 'dist/runtime.js'), action, '--workspace', v.workspace, '--thread', v.thread, ...(allowOffline ? ['--allow-offline'] : []), ...(action === 'workspace-stop' ? ['--idle-only'] : [])]));
  // 先核对服务与任务；无发现记录才视作首次打开，其他错误保留现场。
  let before = null;
  if (await exists(join(v.workspace, 'clapgrid/service.json'))) {
    const current = await runtime(pkg, 'workspace-status', true);
    if (current.state !== 'offline') before = current;
  }
  if (before?.taskLocked || before?.modification) throw Error('项目有运行任务或正在编辑；等待结束后重新执行更新，不中断任务');
  const backupRoot = resolve(v['backup-root'] || join(stateDir, 'updates'));
  for (const directory of [source, pkg, cache, join(resolve(v.workspace), 'clapgrid')]) {
    const within = relative(directory, backupRoot);
    if (!within || (!within.startsWith('..') && !within.startsWith('/'))) throw Error('恢复包必须保存在插件和项目目录之外');
  }
  const backup = join(backupRoot, randomUUID());
  await mkdir(backup, { recursive: true }); report.backup = backup;
  await cp(source, join(backup, 'source'), { recursive: true });
  const oldDigest = await pluginFingerprint(source, { raw: true });
  if (await pluginFingerprint(join(backup, 'source'), { raw: true }) !== oldDigest) throw Error('插件源备份验证失败');
  if (await exists(previousInstalled)) {
    if (await pluginFingerprint(previousInstalled, { raw: true }) !== oldDigest) throw Error('旧安装缓存与市场源不一致，需先核对恢复来源；更新未执行');
    await cp(previousInstalled, join(backup, 'installed'), { recursive: true });
    if (await pluginFingerprint(join(backup, 'installed'), { raw: true }) !== oldDigest) throw Error('旧安装备份验证失败');
  }
  const oldTarget = await exists(targetFile) ? await readFile(targetFile) : null;
  if (oldTarget) await writeFile(join(backup, 'plugin-update.json'), oldTarget);
  await writeFile(join(backup, 'recovery.json'), JSON.stringify({ source, previousInstalled, destination, targetFile, oldDigest, target: identity }, null, 2));
  const staged = source + '.staged-' + randomUUID();
  const saved = source + '.previous-' + randomUUID();
  await cp(pkg, staged, { recursive: true });
  if ((await readPluginIdentity(staged)).contentFingerprint !== identity.contentFingerprint) throw Error('暂存安装包校验失败');
  const install = () => run(v.installer || 'codex', ['plugin', 'add', `clapgrid@${catalog.name}`, '--json']);
  let moved = false, switched = false, stopped = false;
  try {
    // 停止操作本身再次核对任务；确认离线后才替换安装源。
    if (before) {
      const stop = await runtime(pkg, 'workspace-stop');
      if (stop.outcome !== 'stopping') throw Error('服务仍有运行任务或编辑，更新未执行');
      for (let i = 0; i < 100; i++) {
        try { await fetch(new URL('/api/identity', before.url), { signal: AbortSignal.timeout(500), redirect: 'error' }); }
        catch (error) { if (error.cause?.code === 'ECONNREFUSED') { stopped = true; break; } }
        await delay(100);
      }
      if (!stopped) throw Error('旧服务离线未确认，更新停止');
    }
    await rename(source, saved); moved = true;
    await rename(staged, source); switched = true;
    await install();
    if ((await readPluginIdentity(destination)).contentFingerprint !== identity.contentFingerprint) throw Error('安装缓存与目标构建不一致');
    report.installed = 'verified'; report.identity = identity; report.installedPath = destination;
    await writeFile(targetFile + '.tmp', JSON.stringify({ schemaVersion: 1, identity, ...(v.revision ? { sourceRepository: await realpath('.') } : {}), installedPath: destination, workspace: v.workspace, observedAt: new Date().toISOString() }, null, 2));
    await rename(targetFile + '.tmp', targetFile);
    const opened = await runtime(destination, 'open');
    const status = await runtime(destination, 'workspace-status');
    const remote = await (await fetch(new URL('/api/identity', status.url), { redirect: 'error', signal: AbortSignal.timeout(3000) })).json();
    if (remote.buildIdentity?.contentFingerprint !== identity.contentFingerprint || opened.instanceId !== status.instanceId
      || (before && before.snapshot.project.id !== status.snapshot.project.id)) throw Error('更新后的服务身份或项目不一致');
    report.service = 'verified'; report.instanceId = status.instanceId; report.url = status.url;
    report.nextStep = '重新加载宿主插件，并实际调用 clapgrid_host_context、clapgrid_status 和打开面板核对；安装成功不等于宿主已重载。';
    await rm(saved, { recursive: true });
  } catch (error) {
    report.error = error.message; report.installed = 'failed';
    // 新服务可能已经启动：先正常停机，无法确认时保留全部备份而不覆盖现场。
    try {
      if (switched) {
        try { const s = await runtime(destination, 'workspace-status');
          const stoppedNew = await runtime(destination, 'workspace-stop');
          if (stoppedNew.outcome !== 'stopping') throw Error('新服务仍忙');
          for (let i = 0; i < 100; i++) { try { await fetch(new URL('/api/identity', s.url), { signal: AbortSignal.timeout(500) }); } catch (e) { if (e.cause?.code === 'ECONNREFUSED') break; } await delay(100); if (i === 99) throw Error('新服务未离线'); }
        } catch (e) { if (!String(e.message).includes('服务身份已改变') && !String(e.message).includes('尚未打开') && !String(e.message).includes('Cannot find module')) throw e; }
        await rename(source, join(backup, 'failed-source'));
      }
      if (moved) await rename(saved, source);
      if (oldTarget) await writeFile(targetFile, oldTarget); else await rm(targetFile, { force: true });
      if (switched) { await install(); if (await pluginFingerprint(previousInstalled, { raw: true }) !== oldDigest) throw Error('旧安装缓存恢复校验失败'); }
      if (before && stopped) await runtime(previousInstalled, 'open');
      report.rollback = 'restored';
    } catch (rollbackError) { report.rollback = 'needs-attention'; report.rollbackError = rollbackError.message; }
    process.exitCode = 1;
  } finally { await rm(staged, { recursive: true, force: true }); }
  await writeFile(join(backup, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ...report, error: error.message })); process.exitCode = 1;
} finally { if (lock) await rm(lock, { recursive: true }); }
