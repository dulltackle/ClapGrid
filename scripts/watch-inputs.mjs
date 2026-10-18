import { watch, existsSync, realpathSync, lstatSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve, relative, dirname, isAbsolute } from 'node:path';
import { sourceIdentity, sameSource, checkInputFilter } from './check-source.mjs';

/** 事件给已观察变化保留generation；周期fresh全内容指纹补查源码，不产生通过证据。 */
export function observeWatchInputs(root, onChange) {
  const initialStarted = performance.now();
  const include = checkInputFilter(root);
  let snapshot = sourceIdentity(root), closed = false, timer;
  const metrics = { initialScanMs: performance.now() - initialStarted, probeCount: 0, probeTotalMs: 0, lastProbeMs: 0, ignoredDirectoryRaceCount: 0 };
  const handles = [], queued = new Set();
  const temporary = path => /^node_modules\/\.(?:vite|vite-temp)(?:\/|$)/.test(path);
  const dependency = path => path.split('/').includes('node_modules');
  const notify = (kind, paths, reason) => { if (!closed) onChange({ kind, paths, reason, observedAt: new Date().toISOString() }); };
  const flush = () => {
    clearTimeout(timer); timer = undefined;
    const paths = [...queued]; queued.clear();
    if (!paths.length) return;
    const tools = paths.filter(path => dependency(path) && !temporary(path));
    if (tools.length) notify('restart-required', tools, '依赖安装或工具输入改变，需重启watch；不继续使用长期进程已加载模块');
    const candidates = paths.filter(path => path !== '.git' && !path.startsWith('.git/') && !dependency(path));
    if (!candidates.length) return;
    const ignored = spawnSync('git', ['-C', root, 'check-ignore', '-z', '--stdin'], { input: candidates.join('\0') + '\0', encoding: 'utf8' });
    if (![0, 1].includes(ignored.status)) { notify('restart-required', candidates, '无法确认watch输入忽略规则'); return; }
    const excluded = new Set(ignored.stdout.split('\0').filter(Boolean));
    // Git 已跟踪输入即使后来匹配 ignore，仍须响应；历史材料按独立输入边界排除。
    const tracked = spawnSync('git', ['-C', root, 'ls-files', '--cached', '-z', '--', ...candidates.map(path => `:(literal)${path}`)], { encoding: 'utf8' });
    if (tracked.status !== 0) { notify('restart-required', candidates, '无法确认watch跟踪输入'); return; }
    const trackedPaths = new Set(tracked.stdout.split('\0').filter(Boolean));
    const inputs = candidates.filter(path => include(path) && (!excluded.has(path) || trackedPaths.has(path)));
    if (inputs.length) notify(inputs.some(path => path.startsWith('scripts/')) ? 'restart-required' : 'source', inputs, '文件系统实际输入事件');
  };
  const enqueue = path => {
    if (closed || temporary(path) || !include(path)) return;
    queued.add(path); clearTimeout(timer); timer = setTimeout(flush, 120);
  };
  const ignoredDirectoryRace = (attached, error) => {
    try {
      if (error.code !== 'ENOENT' || error.syscall !== 'scandir' || typeof error.path !== 'string' || !isAbsolute(error.path) || resolve(error.path) !== error.path) return false;
      const within = relative(attached, error.path);
      if (!within || within === '..' || within.startsWith('../') || isAbsolute(within)) return false;
      let ancestor = error.path;
      for (;;) { try { lstatSync(ancestor); break; } catch (failure) { if (failure.code !== 'ENOENT' || dirname(ancestor) === ancestor) return false; ancestor = dirname(ancestor); } }
      if (realpathSync(ancestor) !== resolve(realpathSync(attached), relative(attached, ancestor))) return false;
      const local = relative(root, error.path).replaceAll('\\', '/');
      if (!local || local === '..' || local.startsWith('../') || isAbsolute(local) || dependency(local) && !temporary(local) && include(local)) return false;
      if (!include(local)) {
        metrics.ignoredDirectoryRaceCount++; metrics.lastIgnoredDirectoryRace = { path: error.path, observedAt: new Date().toISOString() }; return true;
      }
      const tracked = spawnSync('git', ['-C', root, 'ls-files', '--cached', '-z', '--', `:(literal)${local}`], { encoding: 'utf8' });
      if (tracked.status !== 0 || tracked.stdout) return false;
      if (!temporary(local) && spawnSync('git', ['-C', root, 'check-ignore', '-q', '--', local]).status !== 0) return false;
      // Node 22 recursive_watch 的目录扫描错误只 emit，不关闭根句柄；输入目录错误仍要求重启。
      metrics.ignoredDirectoryRaceCount++; metrics.lastIgnoredDirectoryRace = { path: error.path, observedAt: new Date().toISOString() }; return true;
    } catch { return false; }
  };
  const attach = (path, callback, options = {}, allowIgnoredRace = false) => {
    try { const handle = watch(path, options, (_event, filename) => filename === null ? notify('restart-required', [], 'watch事件缺少路径，无法确认输入范围') : callback(String(filename).replaceAll('\\', '/'))); handle.on('error', error => { if (!allowIgnoredRace || !ignoredDirectoryRace(path, error)) notify('restart-required', [path], `watch句柄失效：${error.message}`); }); handles.push(handle); }
    catch (error) { notify('restart-required', [path], `无法监听实际输入：${error.message}`); }
  };
  attach(root, enqueue, { recursive: true }, true);
  // node_modules可能是symlink，作为独立根监听实际安装；明确排除执行器自己的Vite临时输出。
  if (existsSync(join(root, 'node_modules'))) attach(join(root, 'node_modules'), path => enqueue(`node_modules/${path}`), { recursive: true }, true);
  attach(realpathSync(process.execPath), () => notify('restart-required', [process.execPath], 'Node工具二进制改变'));
  const gitDirectory = execFileSync('git', ['-C', root, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
  attach(gitDirectory, path => { if (path === 'HEAD' || path === 'commondir' || path === 'config' || path.startsWith('refs/')) enqueue('.git-state'); }, { recursive: true });
  const probe = () => {
    const started = performance.now();
    flush();
    try { const current = sourceIdentity(root); if (!sameSource(snapshot, current)) notify('source', [], '周期fresh完整源码指纹变化'); snapshot = current; return current; }
    catch (error) { notify('restart-required', [], `无法重新确认源码输入：${error.message}`); return undefined; }
    finally { metrics.probeCount++; metrics.lastProbeMs = performance.now() - started; metrics.probeTotalMs += metrics.lastProbeMs; }
  };
  const polling = setInterval(probe, 2000);
  return { probe, metrics: () => ({ ...metrics }), close() { closed = true; clearInterval(polling); clearTimeout(timer); for (const handle of handles) handle.close(); } };
}
