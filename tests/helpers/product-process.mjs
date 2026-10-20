import { readFileSync, readlinkSync } from 'node:fs';

/** 只识别本例产品进程的出生身份，供服务及媒体退出测试使用。 */
export function processIdentity(pid = process.pid) {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      return { pid, pidNamespace: readlinkSync(`/proc/${pid}/ns/pid`), boot: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), start: fields[19], state: fields[0] };
    }
    return { pid };
  } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return null; throw error; }
}

/** true 是原进程仍活着，false 是原进程已结束，null 表示身份无法确认。 */
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

/** 只沿已确认存活父进程的 /proc 亲子边登记；保留出生身份以便父进程先退出后仍能收尾。 */
export function rememberDescendants(owners) {
  if (process.platform !== 'linux') return;
  for (const parent of owners.values()) {
    if (ownerAlive(parent) !== true) continue;
    let children;
    try { children = readFileSync(`/proc/${parent.pid}/task/${parent.pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number); }
    catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) continue; throw error; }
    for (const pid of children) {
      const child = processIdentity(pid);
      if (!child) continue;
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        if (Number(fields[1]) === parent.pid && ownerAlive(parent) === true && ownerAlive(child) === true) owners.set(pid, child);
      } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; }
    }
  }
}

/** 本例服务兜底退出；不凭裸 PID 认领，不删除目录。 */
export async function stopOwnedProcess(owner, timeoutMs = 2000) {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const send = signal => {
    const alive = ownerAlive(owner);
    if (alive === null) throw Error(`进程 ${owner?.pid} 出生身份不明，保留现场`);
    if (alive === false) return false;
    try { process.kill(owner.pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    return true;
  };
  if (!send('SIGTERM')) return;
  await delay(Math.min(200, timeoutMs));
  send('SIGKILL');
  const deadline = Date.now() + Math.max(1, timeoutMs - 200);
  while (ownerAlive(owner) !== false) {
    if (Date.now() >= deadline) throw Error(`进程 ${owner.pid} 未确认退出，保留现场`);
    await delay(10);
  }
}
