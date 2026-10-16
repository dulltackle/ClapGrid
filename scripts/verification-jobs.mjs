import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readlinkSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { release } from 'node:os';
import { setTimeout } from 'node:timers/promises';
import { git, sameSource, sourceIdentity } from './check-source.mjs';
import { atomicJson, reserveCheckRun, releaseCheckReservation, currentCheckRun, checkRunProcessesEnded, stopCheckRun, stateDirectory } from './check-lifecycle.mjs';
export { atomicJson } from './check-lifecycle.mjs';

function toolIdentity(commands, args = ['--version']) {
  for (const command of commands.filter(Boolean)) {
    const located = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], { encoding: 'utf8', timeout: 5000 });
    const path = located.status === 0 ? located.stdout.trim().split(/\r?\n/)[0] : undefined;
    if (!path) continue;
    const version = spawnSync(path, args, { encoding: 'utf8', timeout: 5000 });
    if (version.status === 0) return { path: realpathSync(path), version: version.stdout.trim().split(/\r?\n/)[0] };
  }
  return null;
}

/** 只记录影响本机检查的环境变量摘要，避免将凭据写入日志。 */
export function verificationEnvironment() {
  const variables = ['PATH', 'CHROME_BIN', 'FFMPEG_BIN', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ', 'CI', 'DISPLAY', 'NODE_OPTIONS', 'NODE_ENV', 'FONTCONFIG_FILE', 'FONTCONFIG_PATH', 'CLAPGRID_BROWSER_BUILD_CACHE', 'npm_config_registry', 'npm_config_userconfig'];
  const environment = Object.fromEntries(variables.map(name => [name, process.env[name] ?? null]));
  const tools = {
    npm: toolIdentity([process.platform === 'win32' ? 'npm.cmd' : 'npm']),
    chrome: toolIdentity(process.env.CHROME_BIN ? [process.env.CHROME_BIN] : ['google-chrome', 'chromium', 'chromium-browser']),
    ffmpeg: toolIdentity([process.env.FFMPEG_BIN ?? 'ffmpeg'], ['-version']),
    ffprobe: toolIdentity(['ffprobe'], ['-version']),
  };
  const fontList = spawnSync('fc-list', ['--format', '%{file}\n'], { encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
  let fontsFingerprint = null;
  if (fontList.status === 0) {
    try {
      const fonts = createHash('sha256');
      for (const path of [...new Set(fontList.stdout.trim().split(/\r?\n/).filter(Boolean))].sort()) { fonts.update(path); fonts.update(readFileSync(path)); }
      fontsFingerprint = `sha256:${fonts.digest('hex')}`;
    } catch { /* 字体不能完整读取时允许新验收，但禁止复用历史通过。 */ }
  }
  let fontConfiguration = null;
  try { if (process.env.FONTCONFIG_FILE) fontConfiguration = `sha256:${createHash('sha256').update(readFileSync(process.env.FONTCONFIG_FILE)).digest('hex')}`; }
  catch { /* 无法读取显式配置时禁止历史复用。 */ }
  return { node: process.version, executable: realpathSync(process.execPath), platform: process.platform, osRelease: release(), arch: process.arch,
    environmentFingerprint: `sha256:${createHash('sha256').update(JSON.stringify(environment)).digest('hex')}`, tools,
    fontsFingerprint, fontConfiguration, sanitizedVariables: ['NODE_TEST_CONTEXT'],
    reusable: Object.values(tools).every(Boolean) && !!fontsFingerprint && (!process.env.FONTCONFIG_FILE || !!fontConfiguration) };
}

export function processIdentity(pid = process.pid) {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      return { pid, pidNamespace: readlinkSync(`/proc/${pid}/ns/pid`), boot: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), start: fields[19], state: fields[0] };
    }
    return { pid };
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function ownerAlive(owner) {
  if (!owner?.pid) return null;
  if (process.platform === 'linux') {
    if (!owner.pidNamespace || owner.pidNamespace !== readlinkSync('/proc/self/ns/pid')) return null;
    const current = processIdentity(owner.pid);
    if (!current) return false;
    if (['Z', 'X'].includes(current.state)) return false;
    if (!owner.boot || !owner.start) return null;
    return current.boot === owner.boot && current.start === owner.start;
  }
  try { process.kill(owner.pid, 0); return null; }
  catch (error) { return error.code === 'ESRCH' ? false : null; }
}

/** 后台任务拥有独立 session。拥有者退出后仍有成员存活时，不能重复启动整条检查链。 */
function ownedProcessesEnded(owner) {
  if (process.platform !== 'linux' || !owner?.boot || !owner?.start || owner.pidNamespace !== readlinkSync('/proc/self/ns/pid')) return false;
  if (readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() !== owner.boot) return true;
  for (const name of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (!['Z', 'X'].includes(fields[0]) && fields[2] === String(owner.pid) && fields[3] === String(owner.pid)) return false;
    } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ESRCH') return false; }
  }
  return true;
}

const terminal = status => ['passed', 'failed', 'cancelled', 'interrupted'].includes(status);
const read = path => JSON.parse(readFileSync(path, 'utf8'));

/** 查询不会把过期心跳当失败；只有确认拥有者已经退出才终结旧任务。 */
export function verificationStatus(directory) {
  const summary = read(join(directory, 'summary.json'));
  if (!terminal(summary.status)) {
    let worker;
    try { worker = read(join(directory, 'worker-owner.json')).owner; } catch { /* 启动器还未发布 worker 身份。 */ }
    const alive = ownerAlive(worker ?? summary.owner);
    if (worker) summary.owner = worker;
    if (alive === false) {
      if (summary.phase === 'starting' && !worker) summary.observation = '启动器已退出，后台任务身份尚未确认；保留登记，不自动重启';
      else if (Date.now() - Date.parse(summary.heartbeatAt ?? summary.startedAt) <= 30000) summary.observation = '心跳仍新鲜，拥有者暂不可观测；保留登记，不自动重启';
      else if ((summary.lifecycleRoot ? checkRunProcessesEnded(summary.lifecycleRoot, summary.token, summary.directory) : ownedProcessesEnded(worker ?? summary.owner)) === true) {
        summary.status = 'interrupted'; summary.completedAt = new Date().toISOString();
        summary.error = '验收拥有者已退出；原日志保留，本次不自动重试';
      } else summary.observation = '拥有者已退出，子进程结束尚未确认；保留登记，不自动重启';
      // 查询只返回观察结果。后台拥有者和注册操作负责写入，避免观察者覆盖新心跳。
    } else if (Date.now() - Date.parse(summary.heartbeatAt ?? summary.startedAt) > 30000) {
      summary.observation = '心跳过期，进程结束尚未确认；请查询原任务，不要重复启动';
    } else if (alive === null) summary.observation = '当前环境无法确认拥有者进程身份；心跳仍新鲜，保留任务，不自动重启';
  }
  return summary;
}

function reusableEvidence(summary) {
  try {
    if (summary.status !== 'passed' || !summary.identity?.environment?.reusable || !summary.checkSummary) return false;
    if (summary.identity.commit !== summary.commit || summary.source?.commit !== summary.commit
      || !Array.isArray(summary.results) || summary.results.length !== 2
      || !['install', 'check'].every(name => summary.results.some(result => result.name === name && result.status === 'passed' && result.exitCode === 0))
      || dirname(dirname(summary.checkSummary)) !== join(summary.checkout, 'logs/check')) return false;
    if (!['install.log', 'check.log'].every(name => existsSync(join(summary.directory, name)))) return false;
    const check = read(summary.checkSummary);
    const current = sourceIdentity(summary.checkout);
    const preflight = check.preflight;
    const pkg = read(join(summary.checkout, 'package.json'));
    const expectedPreflight = pkg.checkPreflight ?? ['typecheck'];
    const evidenceComplete = result => {
      if (!result.log || !existsSync(result.log)) return false;
      if (result.name.startsWith('test') && pkg.scripts?.[result.name]?.includes('scripts/test-runner.mjs') && !result.testReport) return false;
      if (!result.testReport) return true;
      const report = read(result.testReport); return report.complete && report.failures?.length === 0;
    };
    return !current.dirty && check.status === 'passed' && check.pending?.length === 0 && check.results?.length === 3
      && preflight?.status === 'passed' && sameSource(summary.source, preflight.source) && sameSource(summary.source, preflight.sourceAfter)
      && preflight.pending?.length === 0 && preflight.results?.length === expectedPreflight.length
      && expectedPreflight.every(name => preflight.results.some(result => result.name === name && result.status === 'passed' && result.exitCode === 0))
      && Array.isArray(check.failures) && check.failures.length === 0
      && ['typecheck', 'test', 'build'].every(name => check.results.some(result => result.name === name && result.status === 'passed' && result.exitCode === 0)
        && existsSync(join(summary.checkout, 'logs/check', summary.checkSummary.split(/[\\/]/).at(-2), `${name}.log`)))
      && [...preflight.results, ...check.results].every(evidenceComplete)
      && sameSource(summary.source, check.source) && sameSource(summary.source, check.sourceAfter)
      && sameSource(summary.source, summary.sourceAfter) && sameSource(summary.source, current);
  } catch { return false; }
}

export async function startVerification(root, revision, outputRoot = join(root, 'logs/verify'), options = {}) {
  if (!revision) throw Error('正式验收必须指定 --revision <提交>');
  root = realpathSync(root); outputRoot = resolve(outputRoot);
  const commit = git(root, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]);
  const runner = createHash('sha256');
  for (const name of ['verify.mjs', 'verification-jobs.mjs', 'verification-worker.mjs', 'check-source.mjs', 'check-runner.mjs', 'check-lifecycle.mjs', 'test-runner.mjs', 'test-reporter.mjs']) runner.update(readFileSync(fileURLToPath(new URL(name, import.meta.url))));
  const identity = { schema: 1, runnerFingerprint: `sha256:${runner.digest('hex')}`, repository: root, commit, tree: git(root, ['rev-parse', `${commit}^{tree}`]), environment: options.environment ?? verificationEnvironment() };
  const key = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  mkdirSync(outputRoot, { recursive: true });
  for (let attempt = 0; attempt < 100; attempt++) {
    const active = currentCheckRun(root);
    if (active) {
      if (active.verificationKey !== key) throw Error('已有检查运行或待清理；同一工作树不能启动不同身份的检查，请查询原任务或使用独立工作树');
      if (!active.verificationDirectory) { await setTimeout(50); continue; }
      const previous = verificationStatus(active.verificationDirectory);
      if (!terminal(previous.status)) return { ...previous, attached: true, reused: false };
      if (previous.status === 'interrupted') {
        // 只在已核对全部登记进程组结束后，复用生命周期的清理入口，不直接删锁。
        await stopCheckRun(root, { token: active.token });
        atomicJson(join(previous.directory, 'summary.json'), previous);
      } else await setTimeout(50); // 等待执行者完成最终清理。
      continue;
    }
    let reservation, directory, spawned = false;
    try {
      try { reservation = reserveCheckRun(root, 'verification', { verificationKey: key }); }
      catch (error) {
        if (existsSync(join(stateDirectory(root), 'active'))) { await setTimeout(50); continue; }
        throw error;
      }
      if (options.reusePassed) {
        const matches = readdirSync(outputRoot).filter(name => name.startsWith('run-')).map(name => {
          try { return read(join(outputRoot, name, 'summary.json')); } catch { return null; }
        }).filter(summary => summary?.key === key && reusableEvidence(summary)).sort((a, b) => b.completedAt.localeCompare(a.completedAt));
        if (matches[0]) { releaseCheckReservation(root, reservation.token); return { ...matches[0], reused: true, attached: false }; }
      }
      directory = mkdtempSync(join(outputRoot, 'run-'));
      const now = new Date().toISOString();
      const summary = { mode: 'verification', runId: directory.split(/[\\/]/).at(-1), token: reservation.token, key, identity, commit, directory, lifecycleRoot: root, checkout: join(directory, 'source'), startedAt: now, heartbeatAt: now,
        owner: processIdentity(), phase: 'starting', status: 'running', results: [] };
      atomicJson(join(directory, 'summary.json'), summary);
      atomicJson(join(stateDirectory(root), 'active/owner.json'), { ...reservation, verificationDirectory: directory });
      const log = openSync(join(directory, 'worker.log'), 'a');
      let child;
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      try { child = spawn(process.execPath, [fileURLToPath(new URL('./verification-worker.mjs', import.meta.url)), directory], { env, detached: true, stdio: ['ignore', log, log], windowsHide: true }); }
      finally { closeSync(log); }
      spawned = !!child.pid;
      if (child.pid) atomicJson(join(directory, 'worker-owner.json'), { owner: processIdentity(child.pid) });
      const started = new Promise((resolveStart, reject) => { child.once('spawn', resolveStart); child.once('error', reject); });
      await started;
      child.unref();
      // worker 发布拥有者前不返回，避免启动者退出后误把新任务判成中断。
      for (let wait = 0; wait < 100; wait++) {
        const running = read(join(directory, 'summary.json'));
        if (running.executionReady && running.owner?.pid === child.pid || terminal(running.status)) return { ...running, attached: false, reused: false };
        if (child.exitCode !== null) throw Error('验收后台任务启动失败，请检查 worker.log');
        await setTimeout(50);
      }
      throw Error(`验收启动未确认，请按 runId 查询；不会自动重启：${summary.runId}`);
    } catch (error) {
      // 已注册任务保留，不能因启动观察超时解除锁并重复执行。
      if (!spawned && reservation) releaseCheckReservation(root, reservation.token);
      if (!spawned && directory && existsSync(join(directory, 'summary.json'))) {
        const summary = read(join(directory, 'summary.json'));
        atomicJson(join(directory, 'summary.json'), { ...summary, status: 'failed', error: String(error), completedAt: new Date().toISOString() });
      }
      throw error;
    }
  }
  throw Error('验收登记尚未就绪，请保留现场并稍后查询原任务');
}

export async function cancelVerification(root, directory) {
  const summary = verificationStatus(directory);
  if (terminal(summary.status)) return summary;
  if (realpathSync(root) !== summary.lifecycleRoot) throw Error('验收工作树不匹配，拒绝取消');
  await stopCheckRun(root, { token: summary.token });
  return waitVerification(directory);
}

export async function waitVerification(directory, options = {}) {
  for (;;) {
    const summary = verificationStatus(directory);
    if (terminal(summary.status)) return summary;
    if (options.signal?.aborted) return cancelVerification(summary.lifecycleRoot, directory);
    await setTimeout(options.pollMs ?? 500);
  }
}

