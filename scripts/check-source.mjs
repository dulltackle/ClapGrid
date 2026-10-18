import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync, openSync, closeSync, fstatSync, constants } from 'node:fs';
import { join } from 'node:path';
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';

const algorithmPath = 'scripts/source-identity.json';
const algorithm = 'sha256-merkle-v1';
const workerKind = 'clapgrid-source-leaves-v1';
const codeScope = 'code-check-v1';
const historicalDirectories = ['docs/productions', 'docs/validation', 'docs/design'];

function inputScope(configured) { return configured && JSON.parse(configured).scope; }
function includesInput(file, scope) {
  return scope !== codeScope || !historicalDirectories.some(directory => file === directory || file.startsWith(`${directory}/`));
}

/** 只有显式采用新范围的目标才排除历史材料；未知路径仍是受检输入。 */
export function checkInputFilter(root) {
  const scope = inputScope(algorithmSnapshot(root));
  return file => includesInput(file, scope);
}

function regularContents(path, stat) {
  // 不跟随替换后的链接，也不因 lstat/open 之间的 FIFO 竞争阻塞线程收尾。
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
  try {
    const actual = fstatSync(fd);
    if (!actual.isFile()) throw Error(`源码条目在读取前改变类型：${path}`);
    if (actual.dev !== stat.dev || actual.ino !== stat.ino) throw Error(`源码条目在读取前被替换：${path}`);
    return readFileSync(fd);
  } finally { closeSync(fd); }
}

function algorithmSnapshot(root) {
  let stat;
  try { stat = lstatSync(join(root, algorithmPath)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!stat.isFile()) throw Error('源码算法配置必须是普通文件');
  const bytes = regularContents(join(root, algorithmPath), stat);
  const value = JSON.parse(bytes);
  const legacy = value.schemaVersion === 1 && Object.keys(value).sort().join(',') === 'algorithm,schemaVersion';
  const scoped = value.schemaVersion === 2 && value.scope === codeScope && Object.keys(value).sort().join(',') === 'algorithm,schemaVersion,scope';
  if ((!legacy && !scoped) || value.algorithm !== algorithm) throw Error('未知源码指纹算法配置');
  return bytes;
}

const sourceFiles = (root, scope) => [...new Set(git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(file => file && includesInput(file, scope)))].sort();
const metadata = (root, fingerprint, scope) => ({ commit: git(root, ['rev-parse', 'HEAD']), tree: git(root, ['rev-parse', 'HEAD^{tree}']), fingerprint,
  dirty: git(root, ['status', '--porcelain', '--untracked-files=all', ...(scope === codeScope ? ['--', '.', ...historicalDirectories.map(path => `:(exclude,literal)${path}`)] : [])]) !== '',
  ...(scope ? { scope } : {}) });
function stableAlgorithm(root, before) {
  const after = algorithmSnapshot(root);
  if (before === null ? after !== null : after === null || !before.equals(after)) throw Error('源码指纹算法在采集期间变化');
}

function leaf(root, file) {
  const path = join(root, file);
  const hash = createHash('sha256');
  let stat;
  try { stat = lstatSync(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return hash.update(JSON.stringify([file, 'missing'])).digest('hex'); }
  if (!stat.isFile() && !stat.isSymbolicLink()) throw Error(`不支持的源码条目：${file}`);
  let contents;
  if (stat.isSymbolicLink()) contents = Buffer.from(readlinkSync(path));
  else contents = regularContents(path, stat);
  return hash.update(JSON.stringify([file, stat.isSymbolicLink() ? 'link' : 'file', stat.mode & 0o111, contents.length])).update(contents).digest('hex');
}

function merkle(files, rows, scope) {
  const values = new Map();
  const expected = new Set(files);
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 2 || !expected.has(row[0]) || !/^[a-f0-9]{64}$/.test(row[1]) || values.has(row[0])) throw Error('源码线程返回重复、未知或不完整条目');
    values.set(row[0], row[1]);
  }
  if (values.size !== files.length) throw Error('源码线程返回集合缺口');
  const hash = createHash('sha256').update(JSON.stringify(scope ? ['clapgrid-source-merkle-v1', scope, files.length] : ['clapgrid-source-merkle-v1', files.length]));
  for (const file of files) hash.update(JSON.stringify([file, values.get(file)]));
  return `${algorithm}:${hash.digest('hex')}`;
}

if (!isMainThread && workerData?.kind === workerKind) {
  const { root, files, nonce } = workerData;
  parentPort.postMessage({ nonce, rows: files.map(file => [file, leaf(root, file)]) });
}

export function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trimEnd();
}

/** 按目标声明的输入范围读取；范围内跟踪文件及未忽略新文件均计入。 */
export function sourceIdentity(root) {
  const configured = algorithmSnapshot(root);
  const scope = inputScope(configured);
  const files = sourceFiles(root, scope);
  if (configured) {
    const fingerprint = merkle(files, files.map(file => [file, leaf(root, file)]), scope);
    stableAlgorithm(root, configured);
    return metadata(root, fingerprint, scope);
  }
  const hash = createHash('sha256');
  for (const file of files) {
    const path = join(root, file);
    let stat;
    try { stat = lstatSync(path); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      hash.update(JSON.stringify([file, 'missing'])); continue;
    }
    if (!stat.isFile() && !stat.isSymbolicLink()) throw Error(`不支持的源码条目：${file}`);
    const contents = stat.isSymbolicLink() ? Buffer.from(readlinkSync(path)) : readFileSync(path);
    hash.update(JSON.stringify([file, stat.isSymbolicLink() ? 'link' : 'file', stat.mode & 0o111, contents.length]));
    hash.update(contents);
  }
  stableAlgorithm(root, configured);
  return metadata(root, `sha256:${hash.digest('hex')}`);
}

/** 每次完整读取当前内容；线程只在本次采集期间存在，退出后才返回。 */
export async function sourceIdentityAsync(root, { signal, workers = Math.min(4, availableParallelism()) } = {}) {
  signal?.throwIfAborted();
  if (!Number.isInteger(workers) || workers < 1 || workers > 8) throw Error('源码线程数量仅支持 1 至 8');
  const configured = algorithmSnapshot(root);
  if (!configured) return sourceIdentity(root);
  const scope = inputScope(configured);
  const files = sourceFiles(root, scope);
  const bins = Array.from({ length: Math.min(workers, Math.max(1, files.length)) }, () => ({ files: [], bytes: 0 }));
  const sizes = files.map(file => {
    try { return { file, size: lstatSync(join(root, file)).size }; }
    catch (error) { if (error.code === 'ENOENT') return { file, size: 0 }; throw error; }
  });
  for (const { file, size } of sizes.sort((a, b) => b.size - a.size)) {
    const bin = bins.reduce((a, b) => a.bytes <= b.bytes ? a : b);
    bin.files.push(file); bin.bytes += size;
  }
  const records = [];
  let failure;
  const stop = error => {
    failure ??= error;
    for (const record of records) if (!record.exited) record.worker.terminate().catch(() => {});
  };
  const abort = () => stop(signal.reason ?? Error('源码采集已取消'));
  signal?.addEventListener('abort', abort, { once: true });
  try {
    for (const bin of bins) {
      signal?.throwIfAborted();
      const nonce = randomUUID();
      const worker = new Worker(new URL(import.meta.url), { execArgv: [], env: {}, workerData: { kind: workerKind, root, files: bin.files, nonce } });
      const record = { worker, exited: false, message: null, done: null };
      record.done = new Promise(done => {
        worker.on('message', message => {
          if (record.message || message?.nonce !== nonce || !Array.isArray(message.rows) || message.rows.length !== bin.files.length || message.rows.some(row => !Array.isArray(row) || !bin.files.includes(row[0]))) stop(Error('源码线程消息身份或集合不符'));
          else record.message = message;
        });
        worker.on('error', stop);
        worker.on('exit', code => {
          record.exited = true;
          if (code !== 0 || !record.message) stop(Error(`源码线程未完整退出：${code}`));
          done();
        });
      });
      records.push(record);
    }
    await Promise.all(records.map(record => record.done));
    if (failure) throw failure;
    signal?.throwIfAborted();
    const fingerprint = merkle(files, records.flatMap(record => record.message.rows), scope);
    stableAlgorithm(root, configured);
    return metadata(root, fingerprint, scope);
  } finally {
    signal?.removeEventListener('abort', abort);
    for (const record of records) if (!record.exited) record.worker.terminate().catch(() => {});
    await Promise.all(records.map(record => record.done));
  }
}

export function sameSource(a, b) {
  return a.commit === b.commit && a.fingerprint === b.fingerprint;
}
