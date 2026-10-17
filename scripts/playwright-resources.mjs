import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, realpathSync, lstatSync, readdirSync, existsSync, rmSync, renameSync, readlinkSync, linkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const stateDirectory = root => join(realpathSync(root), 'logs/check-state');
function atomicJson(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n'); renameSync(temporary, path);
}
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const entryExists = path => { try { lstatSync(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** 创建在本次输出目录下的专属资源根，所有权登记完成前不允许启动 worker。 */
export function registerPlaywrightResources(container, executionId) {
  container = realpathSync(container);
  const upstream = JSON.parse(process.env.CLAPGRID_CHECK_REGISTRY ?? 'null');
  if (!upstream?.root || !upstream.token) throw Error('Playwright 资源需要实际检查拥有者');
  const scopes = [{ root: upstream.root, token: upstream.token }, ...(upstream.ancestors ?? [])];
  for (const scope of scopes) if (read(join(stateDirectory(scope.root), 'active/owner.json')).token !== scope.token) throw Error('检查拥有者身份变化，拒绝创建浏览器资源');
  const resourceId = randomUUID();
  const directory = join(container, `playwright-resources-${resourceId}`);
  const marker = { resourceId, executionId, directory, container };
  const registrations = scopes.map(scope => ({ ...scope, path: join(stateDirectory(scope.root), 'active', `resource-${resourceId}.json`) }));
  const resource = { schemaVersion: 1, ...marker, marker, registrations, ready: false, cleanupEvidence: join(container, `playwright-resource-${resourceId}-cleanup.json`) };
  // 先预约精确路径；创建/标记阶段被强杀时仍有可恢复登记，不会启动未登记浏览器。
  for (const scope of registrations) {
    if (read(join(dirname(scope.path), 'owner.json')).token !== scope.token) throw Error(`祖先检查身份变化，保留未启动资源：${directory}`);
    atomicJson(scope.path, { ...resource, scope: { root: scope.root, token: scope.token } });
  }
  mkdirSync(directory, { mode: 0o700 });
  writeFileSync(join(directory, '.owner.json'), JSON.stringify(marker), { mode: 0o600 });
  resource.ready = true;
  for (const scope of registrations) {
    if (read(join(dirname(scope.path), 'owner.json')).token !== scope.token) throw Error('资源创建后拥有者身份变化，保留现场');
    atomicJson(scope.path, { ...resource, scope: { root: scope.root, token: scope.token } });
  }
  return resource;
}
function completed(resource) {
  if (!existsSync(resource.cleanupEvidence)) return false;
  const evidence = read(resource.cleanupEvidence);
  if (evidence.status !== 'removed' || !same(evidence.marker, resource.marker)) throw Error('资源完成证据身份不符，保留登记');
  if (entryExists(resource.directory)) throw Error('已完成的资源根重新出现，保留现场');
  return true;
}
function unregister(resource) {
  for (const registration of resource.registrations) {
    const ownerPath = join(dirname(registration.path), 'owner.json');
    let owner; try { owner = read(ownerPath); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (owner.token !== registration.token || !existsSync(registration.path)) continue;
    let actual; try { actual = read(registration.path); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (actual.resourceId !== resource.resourceId || !same(actual.marker, resource.marker) || actual.scope?.token !== registration.token) throw Error('资源登记身份变化，拒绝移除登记');
    try { if (read(ownerPath).token !== registration.token) throw Error('清理时检查拥有者身份变化'); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    rmSync(registration.path, { force: true });
  }
}
function cleanerIdentity() {
  return { pid: process.pid, birth: processBirth(process.pid), namespace: process.platform === 'linux' ? readlinkSync('/proc/self/ns/pid') : process.platform };
}
function processBirth(pid) {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(') ') + 2).split(' ');
      return ['Z', 'X'].includes(fields[0]) ? undefined : fields[19];
    }
    if (process.platform !== 'win32') return execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' }).trim() || undefined;
    process.kill(pid, 0); return 'alive';
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes(error.code) || error.status === 1) return undefined;
    throw error;
  }
}
function releaseCleanupLock(path, held) {
  if (!same(read(path), held)) throw Error('清理锁身份已变化，保留新锁');
  rmSync(path);
}
/** 原子硬链接发布完整身份；恢复死锁时用该 lockId 的独立锁串行接管。 */
async function acquireCleanupLock(resource, path, confirmGroupsEnded, depth = 0) {
  if (depth > 16) throw Error('清理锁恢复链过深，保留现场');
  const held = { marker: resource.marker, lockId: randomUUID(), cleaner: cleanerIdentity() };
  if (!held.cleaner.birth) throw Error('无法确认清理拥有者出生身份');
  const candidate = `${path}.${held.lockId}.candidate`;
  writeFileSync(candidate, JSON.stringify(held), { flag: 'wx', mode: 0o600 });
  const deadline = Date.now() + 3000;
  try {
    while (true) {
      try { linkSync(candidate, path); return held; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      let existing;
      try { existing = read(path); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (!same(existing.marker, resource.marker) || !uuid(existing.lockId) || !Number.isSafeInteger(existing.cleaner?.pid) || existing.cleaner.pid < 1 || typeof existing.cleaner.birth !== 'string' || !existing.cleaner.birth || typeof existing.cleaner.namespace !== 'string' || existing.cleaner.namespace !== held.cleaner.namespace) throw Error('资源清理锁身份未知，保留现场');
      if (processBirth(existing.cleaner.pid) !== existing.cleaner.birth) {
        if (confirmGroupsEnded() !== true) throw Error('进程组结束尚未确认，拒绝恢复清理锁');
        const recoveryPath = `${resource.cleanupEvidence}.recovery-${existing.lockId}`;
        const recovery = await acquireCleanupLock(resource, recoveryPath, confirmGroupsEnded, depth + 1);
        try {
          let actual; try { actual = read(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
          // 同一旧 lockId 的恢复者串行核对；已换成新拥有者时绝不 unlink。
          if (actual && same(actual, existing)) {
            if (confirmGroupsEnded() !== true || processBirth(existing.cleaner.pid) === existing.cleaner.birth) throw Error('清理恢复前拥有者或组身份变化');
            rmSync(path);
          }
        } finally { releaseCleanupLock(recoveryPath, recovery); }
        continue;
      }
      if (Date.now() >= deadline) throw Error('同身份资源仍在清理，保留登记');
      await delay(20);
    }
  } finally { rmSync(candidate); }
}
async function cleanup(resource, confirmGroupsEnded) {
  const lockPath = `${resource.cleanupEvidence}.lock`;
  const held = await acquireCleanupLock(resource, lockPath, confirmGroupsEnded);
  const intentPath = `${resource.cleanupEvidence}.intent.json`;
  try {
    if (confirmGroupsEnded() !== true) throw Error('资源清理锁取得后组或拥有者身份变化，保留登记');
    if (!completed(resource)) {
      let intent = existsSync(intentPath) ? read(intentPath) : null;
      if (intent && (!same(intent.marker, resource.marker) || !same(intent.registrations, resource.registrations) || intent.groupsEnded !== true)) throw Error('资源清理意图身份不符，保留登记');
      if (!entryExists(resource.directory)) {
        if (confirmGroupsEnded() !== true || !same(read(lockPath), held)) throw Error('恢复完成证据前组或清理身份变化');
        if (resource.ready && !intent) throw Error('资源根缺失且没有同身份删除意图或完成证据，保留登记');
        atomicJson(resource.cleanupEvidence, { schemaVersion: 1, status: 'removed', marker: resource.marker, completedAt: new Date().toISOString(), groupsEnded: true, ...(intent ? { recoveredIntent: intentPath } : { neverCreated: true }) });
      } else {
        const stat = lstatSync(resource.directory);
        if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(resource.directory) !== resource.directory || dirname(resource.directory) !== resource.container || realpathSync(resource.container) !== resource.container || resolve(resource.cleanupEvidence, '..') !== resource.container) throw Error('资源路径不再对应本次专属根，拒绝清理');
        const directoryIdentity = { dev: stat.dev, ino: stat.ino };
        if (intent && !same(intent.directoryIdentity, directoryIdentity)) throw Error('资源清理目标已替换，保留现场');
        const markerPath = join(resource.directory, '.owner.json');
        if (entryExists(markerPath)) {
          if (lstatSync(markerPath).isSymbolicLink() || !same(read(markerPath), resource.marker)) throw Error('资源所有权标记不符，拒绝清理');
        } else if (!intent) throw Error('资源所有权标记缺失，拒绝清理');
        if (confirmGroupsEnded() !== true || !same(read(lockPath), held)) throw Error('删除前组结束或清理身份变化');
        if (!intent) {
          intent = { schemaVersion: 1, marker: resource.marker, registrations: resource.registrations, directoryIdentity, groupsEnded: true, verifiedAt: new Date().toISOString(), cleaner: held.cleaner };
          atomicJson(intentPath, intent);
        }
        rmSync(resource.directory, { recursive: true, maxRetries: 5, retryDelay: 50 });
        atomicJson(resource.cleanupEvidence, { schemaVersion: 1, status: 'removed', marker: resource.marker, completedAt: new Date().toISOString(), groupsEnded: true });
      }
    }
    unregister(resource);
  } finally { releaseCleanupLock(lockPath, held); }
}

/** 只处理当前/祖先令牌明确登记的资源；调用者必须已确认全部本次组结束。 */
export async function cleanupCheckResources(activeDirectory, token, confirmGroupsEnded) {
  const owner = read(join(activeDirectory, 'owner.json'));
  if (owner.token !== token || typeof confirmGroupsEnded !== 'function' || confirmGroupsEnded(owner.root, token) !== true) throw Error('检查进程组结束或拥有权尚未确认，保留资源与锁');
  for (const name of readdirSync(activeDirectory).filter(name => /^resource-[\w-]+\.json$/.test(name))) {
    const path = join(activeDirectory, name);
    let resource;
    try { resource = read(path); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (resource.scope?.root !== owner.root || resource.scope?.token !== token || !resource.registrations?.some(scope => scope.path === path && scope.token === token)) throw Error('资源登记不属于当前检查，保留现场');
    await cleanup(resource, () => confirmGroupsEnded(owner.root, token));
  }
}


export function removeOwnedSubdirectory(directory, root, executionId) {
  const marker = read(join(root, '.owner.json'));
  if (lstatSync(join(root, '.owner.json')).isSymbolicLink() || lstatSync(root).isSymbolicLink() || realpathSync(root) !== root || marker.directory !== root || marker.executionId !== executionId || marker.container !== dirname(root)) throw Error('浏览器资源根所有权不符，拒绝删除子目录');
  if (!entryExists(directory)) return;
  if (dirname(directory) !== root || lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== directory) throw Error('浏览器临时目录路径被替换，拒绝删除');
  rmSync(directory, { recursive: true, maxRetries: 5, retryDelay: 50 });
}
