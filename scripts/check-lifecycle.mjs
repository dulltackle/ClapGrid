import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, realpathSync, existsSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
export const stateDirectory = root => join(realpathSync(root), 'logs/check-state');
const lockDirectory = root => join(stateDirectory(root), 'active');

function birth(pid) {
  try {
    if (process.platform === 'linux') return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[19];
    if (process.platform !== 'win32') return execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' }).trim();
    process.kill(pid, 0); return 'alive';
  } catch { return undefined; }
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
  let directory, owner, owns = false;
  if (inherited && token && process.env.CLAPGRID_CHECK_CHILD_ROOT === root) {
    directory = lockDirectory(inherited);
    owner = read(join(directory, 'owner.json'));
    if (owner.token !== token || birth(owner.pid) !== owner.birth) throw Error('父检查运行身份已失效');
  } else {
    directory = lockDirectory(root);
    mkdirSync(stateDirectory(root), { recursive: true });
    if (existsSync(join(stateDirectory(root), 'stopping'))) throw Error('旧检查正在停止，请等待退出后再启动');
    try { mkdirSync(directory); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let active;
      try { active = read(join(directory, 'owner.json')); } catch { /* 初始化尚未完成也不能抢锁。 */ }
      throw Error(`已有检查运行或待清理：${JSON.stringify(active ?? { directory })}；运行记录：${directory}；请先运行 npm run check:stop`);
    }
    owns = true;
    owner = { token: randomUUID(), pid: process.pid, birth: birth(process.pid), root, kind, startedAt: new Date().toISOString() };
    writeFileSync(join(directory, 'owner.json'), JSON.stringify(owner, null, 2));
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const context = {
    root: owner.root, signal: controller.signal,
    env: { ...process.env, CLAPGRID_CHECK_SCOPE: owner.root, CLAPGRID_CHECK_TOKEN: owner.token, CLAPGRID_CHECK_CHILD_ROOT: '' },
    recordLog(path) { writeFileSync(join(directory, `activity-${process.pid}.json`), JSON.stringify({ pid: process.pid, directory: path })); },
    register(pid) {
      const group = { pid, birth: birth(pid) };
      if (!group.birth) throw Error(`无法确认检查子进程 ${pid} 的身份`);
      group.path = join(directory, `group-${pid}.json`);
      writeFileSync(group.path, JSON.stringify(group)); return group;
    },
    unregister(group) { rmSync(group.path, { force: true }); },
  };
  try { return await work(context); }
  finally {
    process.off('SIGINT', cancel); process.off('SIGTERM', cancel);
    options.signal?.removeEventListener('abort', cancel);
    if (owns) {
      // 包括组长提前退出但孙进程仍运行的情况，退出确认前不释放锁。
      for (const group of groups(directory)) await stopGroup(group);
      rmSync(directory, { recursive: true });
    }
  }
}

export async function stopCheckRun(root) {
  const state = stateDirectory(root), directory = lockDirectory(root);
  mkdirSync(state, { recursive: true });
  const stopping = join(state, 'stopping');
  const fd = openSync(stopping, 'wx'); closeSync(fd);
  try {
    if (!existsSync(directory)) return { status: 'idle' };
    const owner = read(join(directory, 'owner.json'));
    if (birth(owner.pid) === owner.birth) process.kill(owner.pid, 'SIGTERM');
    const deadline = Date.now() + 10000;
    while (existsSync(directory) && birth(owner.pid) === owner.birth && Date.now() < deadline) await delay(50);
    if (existsSync(directory)) {
      if (birth(owner.pid) === owner.birth) throw Error(`检查 ${owner.pid} 尚未完成停止，保留锁；请查看日志`);
      for (const group of groups(directory)) await stopGroup(group);
      if (read(join(directory, 'owner.json')).token !== owner.token) throw Error('运行身份已变化，拒绝清理');
      rmSync(directory, { recursive: true });
    }
    return { status: 'cancelled', run: owner };
  } finally { rmSync(stopping, { force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await stopCheckRun(resolve(import.meta.dirname, '..')), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
