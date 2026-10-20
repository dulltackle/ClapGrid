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
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
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
