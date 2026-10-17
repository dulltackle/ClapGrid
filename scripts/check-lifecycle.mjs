import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, realpathSync, existsSync, openSync, closeSync, readlinkSync, chmodSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createServer, createConnection } from 'node:net';
import { tmpdir } from 'node:os';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
export const stateDirectory = root => join(realpathSync(root), 'logs/check-state');
const lockDirectory = root => join(stateDirectory(root), 'active');
const namespace = () => process.platform === 'linux' ? readlinkSync('/proc/self/ns/pid') : process.platform;

export function atomicJson(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  renameSync(temporary, path);
}

export function currentCheckRun(root) {
  try { return read(join(lockDirectory(root), 'owner.json')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** 启动器先预约唯一工作树锁，后台执行者凭同一令牌接管，避免启动窗口重复执行。 */
export function reserveCheckRun(root, kind, metadata = {}) {
  root = realpathSync(root);
  const directory = lockDirectory(root);
  mkdirSync(stateDirectory(root), { recursive: true });
  if (existsSync(join(stateDirectory(root), 'stopping'))) throw Error('旧检查正在停止，请等待退出后再启动');
  try { mkdirSync(directory); }
  catch (error) { if (error.code === 'EEXIST') throw Error('已有检查运行或待清理；请查询原任务或运行 npm run check:stop'); throw error; }
  const token = randomUUID();
  const owner = { ...metadata, token, pid: process.pid, birth: birth(process.pid), namespace: namespace(), root, kind, reservation: true, startedAt: new Date().toISOString(),
    socket: process.platform === 'win32' ? `\\\\.\\pipe\\clapgrid-${token}` : join(tmpdir(), `clapgrid-${token}.sock`) };
  atomicJson(join(directory, 'owner.json'), owner);
  return owner;
}

export function releaseCheckReservation(root, token) {
  const owner = currentCheckRun(root);
  if (owner?.reservation && owner.token === token) rmSync(lockDirectory(root), { recursive: true });
}

/** 使用登记的全部进程组核对结束；子命令可能拥有不同 session，不能只扫描 worker 的 session。 */
export function checkRunProcessesEnded(root, token, evidenceDirectory) {
  const owner = currentCheckRun(root);
  if (!owner || owner.token !== token) {
    try { return evidenceDirectory && read(join(evidenceDirectory, 'lifecycle-ended.json')).token === token ? true : null; }
    catch { return null; }
  }
  if (owner.namespace !== namespace() || owner.reservation) return null;
  if (birth(owner.pid) === owner.birth) return false;
  return groups(lockDirectory(root)).every(group => !groupAlive(group));
}

export function checkRunGroupsEnded(root, token) {
  const owner = currentCheckRun(root);
  if (!owner || owner.token !== token || owner.namespace !== namespace() || owner.reservation) return null;
  return groups(lockDirectory(root)).every(group => !groupAlive(group));
}

function requestStop(owner) {
  return new Promise((resolveRequest, reject) => {
    const client = createConnection(owner.socket);
    client.setTimeout(1500, () => client.destroy(Error('控制通道响应超时')));
    client.on('error', reject);
    let text = '';
    client.on('connect', () => client.write(JSON.stringify({ token: owner.token, command: 'cancel' }) + '\n'));
    client.on('data', chunk => { text += chunk; });
    client.on('end', () => {
      try { const result = JSON.parse(text); if (!result.accepted) throw Error('控制通道拒绝停止请求'); resolveRequest(result); }
      catch (error) { reject(error); }
    });
  });
}

function birth(pid) {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      return stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[19];
    }
    if (process.platform !== 'win32') return execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' }).trim();
    process.kill(pid, 0); return 'alive';
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes(error.code) || (error.status === 1 && !String(error.stdout ?? '').trim())) return undefined;
    throw error;
  }
}

function groupAlive(group) {
  const current = birth(group.pid);
  if (current && current !== group.birth) return false;
  if (process.platform === 'win32') return !!current;
  // 排除已退出但尚待父进程回收的僵尸；不能只检查组长是否仍在。
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,pgid=,stat='], { encoding: 'utf8' });
  return rows.split('\n').some(row => {
    const [, pgid, stat] = row.trim().split(/\s+/);
    return Number(pgid) === group.pid && !stat?.startsWith('Z');
  });
}

function groups(directory) {
  return readdirSync(directory).filter(file => file.startsWith('group-')).flatMap(file => {
    try { return [{ ...read(join(directory, file)), path: join(directory, file) }]; }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  });
}

async function terminate(group, signal) {
  if (!groupAlive(group)) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(group.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-group.pid, signal);
  } catch (error) { if (error.code !== 'ESRCH') throw error; }
}

export async function stopGroup(group) {
  await terminate(group, 'SIGTERM');
  const grace = Date.now() + 1500;
  while (groupAlive(group) && Date.now() < grace) await delay(40);
  if (groupAlive(group)) await terminate(group, 'SIGKILL');
  const deadline = Date.now() + 3000;
  while (groupAlive(group) && Date.now() < deadline) await delay(40);
  if (groupAlive(group)) throw Error(`子进程组 ${group.pid} 尚未退出，保留运行锁`);
}

/** 锁绑定真实工作树路径；嵌套 check 只继承本次运行身份，不另占源工作树。 */
export async function withCheckRun(root, kind, work, options = {}) {
  root = realpathSync(root);
  const inherited = process.env.CLAPGRID_CHECK_SCOPE;
  const token = process.env.CLAPGRID_CHECK_TOKEN;
  let upstream;
  let ancestors = [];
  if (process.env.CLAPGRID_CHECK_REGISTRY) {
    upstream = JSON.parse(process.env.CLAPGRID_CHECK_REGISTRY);
    ancestors = [{ root: upstream.root, token: upstream.token }, ...(upstream.ancestors ?? [])];
    for (const ancestor of ancestors) {
      const registryOwner = read(join(lockDirectory(ancestor.root), 'owner.json'));
      if (registryOwner.token !== ancestor.token) throw Error('上游检查身份已失效');
      if (existsSync(join(lockDirectory(ancestor.root), 'cancelled'))) throw Object.assign(Error('上游检查已取消，不启动新的子检查'), { cancelled: true });
    }
  }
  let directory, owner, owns = false;
  if (inherited && token && process.env.CLAPGRID_CHECK_CHILD_ROOT === root) {
    directory = lockDirectory(inherited);
    owner = read(join(directory, 'owner.json'));
    if (owner.token !== token || birth(owner.pid) !== owner.birth) throw Error('父检查运行身份已失效');
  } else {
    directory = lockDirectory(root);
    mkdirSync(stateDirectory(root), { recursive: true });
    if (!options.reservation && existsSync(join(stateDirectory(root), 'stopping'))) throw Error('旧检查正在停止，请等待退出后再启动');
    const reserved = options.reservation ? currentCheckRun(root) : null;
    if (options.reservation && (!reserved?.reservation || reserved.token !== options.reservation)) throw Error('后台检查预约身份已失效');
    try { if (!reserved) mkdirSync(directory); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let active;
      try { active = read(join(directory, 'owner.json')); } catch { /* 初始化尚未完成也不能抢锁。 */ }
      throw Error(`已有检查运行或待清理：${JSON.stringify(active ?? { directory })}；运行记录：${directory}；请先运行 npm run check:stop`);
    }
    owns = true;
    const token = reserved?.token ?? randomUUID();
    owner = { ...reserved, ...options.metadata, token, pid: process.pid, birth: birth(process.pid), namespace: namespace(), root, kind, reservation: false, startedAt: reserved?.startedAt ?? new Date().toISOString(),
      socket: process.platform === 'win32' ? `\\\\.\\pipe\\clapgrid-${token}` : join(tmpdir(), `clapgrid-${token}.sock`) };
    atomicJson(join(directory, 'owner.json'), owner);
  }
  const controller = new AbortController();
  const cancel = () => {
    if (controller.signal.aborted) return;
    try { writeFileSync(join(directory, 'cancelled'), 'requested'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    controller.abort();
  };
  const ancestorActive = ancestor => {
    try { return read(join(lockDirectory(ancestor.root), 'owner.json')).token === ancestor.token && !existsSync(join(lockDirectory(ancestor.root), 'cancelled')); }
    catch { return false; }
  };
  ancestors = ancestors.filter(ancestor => ancestor.root !== owner.root || ancestor.token !== owner.token);
  let server;
  if (owns) {
    server = createServer(client => {
      let text = '';
      client.setTimeout(1500, () => client.destroy());
      client.on('error', () => {});
      client.on('data', chunk => {
        text += chunk;
        if (text.length > 4096) { client.destroy(); return; }
        if (!text.includes('\n')) return;
        try {
          const request = JSON.parse(text);
          const accepted = request.token === owner.token && request.command === 'cancel';
          if (accepted) cancel();
          client.end(JSON.stringify({ accepted }));
        } catch { client.end(JSON.stringify({ accepted: false })); }
      });
    });
    await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(owner.socket, resolveListen); });
    if (process.platform !== 'win32') chmodSync(owner.socket, 0o600);
    server.unref();
  }
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted || existsSync(join(directory, 'cancelled'))) cancel();
  // 后台 worker 可以脱离观察终端，但仍属于启动它的检查范围；祖先取消不能遗留新 session。
  const watcher = setInterval(() => { if (existsSync(join(directory, 'cancelled')) || ancestors.some(ancestor => !ancestorActive(ancestor))) cancel(); }, 100);
  watcher.unref();
  const context = {
    root: owner.root, signal: controller.signal,
    env: { ...process.env, CLAPGRID_CHECK_SCOPE: owner.root, CLAPGRID_CHECK_TOKEN: owner.token, CLAPGRID_CHECK_CHILD_ROOT: '',
      CLAPGRID_CHECK_REGISTRY: JSON.stringify({ root: owner.root, token: owner.token, ancestors }) },
    recordLog(path) { atomicJson(join(directory, `activity-${process.pid}.json`), { pid: process.pid, directory: path }); },
    register(pid) {
      const group = { pid, birth: birth(pid) };
      if (!group.birth) throw Error(`无法确认检查子进程 ${pid} 的身份`);
      // 独立工作树的子检查仍是本次命令的后代，取消时也必须覆盖其新进程组。
      const activeAncestors = ancestors.filter(ancestorActive);
      if (activeAncestors.length !== ancestors.length) cancel();
      group.paths = [...new Set([directory, ...activeAncestors.map(ancestor => lockDirectory(ancestor.root))])].map(path => join(path, `group-${pid}.json`));
      for (const path of group.paths) atomicJson(path, group);
      return group;
    },
    unregister(group) { for (const path of group.paths) rmSync(path, { force: true }); },
  };
  try { return await work(context); }
  finally {
    clearInterval(watcher);
    process.off('SIGINT', cancel); process.off('SIGTERM', cancel);
    options.signal?.removeEventListener('abort', cancel);
    if (owns) {
      // 包括组长提前退出但孙进程仍运行的情况，退出确认前不释放锁。
      for (const group of groups(directory)) await stopGroup(group);
      if (readdirSync(directory).some(name => name.startsWith('resource-'))) await (await import('./playwright-resources.mjs')).cleanupCheckResources(directory, owner.token, checkRunGroupsEnded);
      await new Promise(resolveClose => server.close(resolveClose));
      if (owner.verificationDirectory) atomicJson(join(owner.verificationDirectory, 'lifecycle-ended.json'), { token: owner.token, endedAt: new Date().toISOString() });
      rmSync(directory, { recursive: true });
    }
  }
}

export async function stopCheckRun(root, options = {}) {
  const state = stateDirectory(root), directory = lockDirectory(root);
  mkdirSync(state, { recursive: true });
  const stopping = join(state, 'stopping');
  const fd = openSync(stopping, 'wx'); closeSync(fd);
  try {
    if (!existsSync(directory)) return { status: 'idle' };
    let owner = read(join(directory, 'owner.json'));
    if (options.token && owner.token !== options.token) throw Error('运行身份已变化，拒绝取消其他任务');
    if (owner.reservation) {
      writeFileSync(join(directory, 'cancelled'), 'requested');
      const ready = Date.now() + 3000;
      while (owner.reservation && Date.now() < ready) {
        await delay(25);
        if (!existsSync(directory)) return { status: 'cancelled', run: owner };
        const next = read(join(directory, 'owner.json'));
        if (next.token !== owner.token) throw Error('运行身份已变化，拒绝取消其他任务');
        owner = next;
      }
      if (owner.reservation) throw Error('后台执行者尚未接管取消请求，保留预约锁和现场');
    }
    let acknowledged = false;
    try { if (owner.socket) { await requestStop(owner); acknowledged = true; } }
    catch {
      // 不可达不等于已经死亡；跨 PID 命名空间尤其不能用本地 /proc 下结论。
    }
    if (!acknowledged && owner.namespace !== namespace()) throw Error('控制通道不可达且 PID 命名空间不同，无法确认旧任务退出；保留锁');
    if (!acknowledged && birth(owner.pid) === owner.birth) process.kill(owner.pid, 'SIGTERM');
    const deadline = Date.now() + 10000;
    while (existsSync(directory) && (acknowledged || birth(owner.pid) === owner.birth) && Date.now() < deadline) await delay(50);
    if (existsSync(directory)) {
      if (acknowledged || birth(owner.pid) === owner.birth) throw Error(`检查 ${owner.pid} 尚未完成停止，保留锁；请查看日志`);
      for (const group of groups(directory)) await stopGroup(group);
      if (read(join(directory, 'owner.json')).token !== owner.token) throw Error('运行身份已变化，拒绝清理');
      if (readdirSync(directory).some(name => name.startsWith('resource-'))) await (await import('./playwright-resources.mjs')).cleanupCheckResources(directory, owner.token, checkRunGroupsEnded);
      if (owner.verificationDirectory) atomicJson(join(owner.verificationDirectory, 'lifecycle-ended.json'), { token: owner.token, endedAt: new Date().toISOString() });
      rmSync(directory, { recursive: true });
      if (process.platform !== 'win32' && owner.socket) rmSync(owner.socket, { force: true });
    }
    return { status: 'cancelled', run: owner };
  } finally { rmSync(stopping, { force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await stopCheckRun(resolve(import.meta.dirname, '..')), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
