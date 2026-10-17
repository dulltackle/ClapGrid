import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, renameSync, rmSync, realpathSync, globSync, lstatSync, readlinkSync } from 'node:fs';
import { join, dirname, resolve, isAbsolute } from 'node:path';

export const bytesIdentity = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export function fingerprint(files: string[]) {
  const hash = createHash('sha256');
  for (const file of [...new Set(files)].sort()) {
    let entry;
    try { entry = lstatSync(file); }
    catch (error) { if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; hash.update(JSON.stringify([file, 'missing'])); continue; }
    const link = entry.isSymbolicLink() ? readlinkSync(file) : null;
    let stat;
    try { stat = statSync(file); }
    catch (error) { if (!link || !['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; hash.update(JSON.stringify([file, 'broken-link', link])); continue; }
    const identity = [file, realpathSync(file), stat.mode & 0o111, link];
    if (stat.isDirectory()) {
      const members = readdirSync(file, { withFileTypes: true }).map(child => [child.name, child.isDirectory() ? 'directory' : child.isSymbolicLink() ? 'link' : child.isFile() ? 'file' : 'other', child.isSymbolicLink() ? readlinkSync(join(file, child.name)) : null]).sort();
      hash.update(JSON.stringify([...identity, 'directory', members]));
    } else if (stat.isFile()) {
      const bytes = readFileSync(file); hash.update(JSON.stringify([...identity, 'file', bytes.length])); hash.update(bytes);
    } else throw Error(`无法确认构建输入类型：${file}`);
  }
  return hash.digest('hex');
}
function walkTree(directory: string, includeDirectories: boolean, ancestors = new Set<string>(), unverifiedLinks = new Set<string>()): string[] {
  const real = realpathSync(directory), result = includeDirectories ? [directory] : [];
  // 回链保留目录本身的绑定/成员身份；其内容已在祖先采集，不能继续递归。
  if (ancestors.has(real)) return result;
  const seen = new Set(ancestors).add(real);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) unverifiedLinks.add(path);
    let stat;
    try { stat = statSync(path); }
    catch (error) { if (!entry.isSymbolicLink() || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; result.push(path); continue; }
    if (stat.isDirectory()) result.push(...walkTree(path, includeDirectories, seen, unverifiedLinks));
    else result.push(path);
  }
  return result;
}
export function treeFiles(directory: string): string[] { return walkTree(directory, false); }
/** 不支持的配置语法视为不确定，由调用者退回真实构建，不猜测 extends。 */
export function configurationTreeInputs(inputs: string[], root: string) {
  const files = new Set(inputs), seen = new Set<string>();
  function visit(file: string) {
    if (seen.has(file) || !existsSync(file)) return;
    if (realpathSync(file) !== resolve(file)) throw Error('链接配置的继承解析边界不确定');
    seen.add(file); files.add(file);
    const config = JSON.parse(readFileSync(file, 'utf8'));
    const options = config.compilerOptions ?? {};
    // 只启用已证明被完整 src 输入覆盖的本项目 alias；不仿制编译器解析器。
    if (options.baseUrl !== undefined) throw Error('baseUrl 的候选解析边界不确定');
    if (options.paths !== undefined && Object.keys(options.paths).length) {
      const entries = Object.entries(options.paths);
      if (dirname(file) !== resolve(root) || entries.length !== 1 || entries[0]?.[0] !== '@/*'
        || JSON.stringify(entries[0][1]) !== JSON.stringify(['./src/panel/*'])) throw Error('自定义 paths 的候选解析边界不确定');
    }
    const inherited = config.extends === undefined ? [] : Array.isArray(config.extends) ? config.extends : [config.extends];
    if (inherited.some((value: unknown) => typeof value !== 'string')) throw Error('无法确认构建配置继承输入');
    for (const value of inherited) {
      // 包名、隐式扩展名与链接配置的编译器解析语义尚未完整建模，保守真实构建。
      if (!(value.startsWith('.') || isAbsolute(value)) || !value.endsWith('.json')) throw Error('无法确认配置继承的编译器解析边界');
      const target = resolve(dirname(file), value);
      if (!existsSync(target)) throw Error('无法确认构建配置继承目标');
      visit(target);
    }
  }
  for (const file of inputs.filter(file => /(?:^|[/\\])tsconfig[^/\\]*\.json$/.test(file))) visit(file);
  return [...files];
}

/** 包内容和已安装运行时依赖、peer 工具均入身份，不能只信 package.json 版本字符串。 */
export function packageTreeInputs(root: string, names: string[]) {
  const files = new Set<string>(), visited = new Set<string>(), unverifiedLinks = new Set<string>();
  function visit(name: string, from: string) {
    const require = createRequire(join(from, 'package.json'));
    // require.resolve 自身会缓存符号链接 realpath；当前磁盘绑定必须独立核对。
    const candidates = (require.resolve.paths(name) ?? []).map(directory => join(directory, name, 'package.json'));
    for (const candidate of candidates) files.add(candidate);
    let path = candidates.find(candidate => existsSync(candidate));
    if (!path) {
      try { path = require.resolve(`${name}/package.json`); }
      catch { try { path = require.resolve(name); } catch { return; } }
    }
    let directory = dirname(realpathSync(path));
    while (!existsSync(join(directory, 'package.json'))) {
      const parent = dirname(directory); if (parent === directory) throw Error(`无法确认构建包边界：${name}`); directory = parent;
    }
    if (visited.has(directory)) return; visited.add(directory);
    for (const file of walkTree(directory, true, new Set(), unverifiedLinks)) files.add(file);
    const metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    for (const dependency of Object.keys({ ...metadata.dependencies, ...metadata.optionalDependencies, ...metadata.peerDependencies })) visit(dependency, directory);
  }
  for (const name of names) visit(name, root);
  return Object.assign([...files], { unverifiedLinks: [...unverifiedLinks] });
}

/** 绑定当前进程已载入的工具；磁盘工具变化后须重启，不能给旧函数贴新身份。 */
export function bindBuildTools(root: string, names: string[]) {
  const toolFiles = () => {
    const inputs = packageTreeInputs(root, names);
    return Object.assign([...inputs, ...[process.env.ESBUILD_BINARY_PATH].filter((file): file is string => Boolean(file)).map(file => resolve(file))], { unverifiedLinks: inputs.unverifiedLinks });
  };
  const loaded = fingerprint(toolFiles()), binary = process.env.ESBUILD_BINARY_PATH;
  const verify = (forCache: boolean) => {
    const files = toolFiles();
    if (process.env.ESBUILD_BINARY_PATH !== binary || fingerprint(files) !== loaded) throw Error('构建工具输入已变化，请重新启动检查');
    // 包内链接可能把工具运行时 import 迁往另一依赖查找根，尚未确认闭包则真实构建。
    if (forCache && files.unverifiedLinks.length) throw Error('工具包内部链接的运行时依赖边界不确定');
    return files;
  };
  return Object.assign(() => verify(false), { cacheInputs: () => verify(true) });
}

function dependencyFingerprint(root: string, inputs: string[], dependencies: string[]) {
  const resolutions = dependencies.filter(file => file.startsWith('resolve:')).map(file => JSON.parse(file.slice(8)) as [string, string]);
  const expanded = dependencies.filter(file => !file.startsWith('resolve:')).flatMap(file => {
    if (!file.startsWith('glob:')) return [file];
    const matches = globSync(file.slice(5));
    if (matches.some(file => lstatSync(file).isSymbolicLink() && statSync(file).isDirectory())) throw Error('扫描符号链接目录边界不确定');
    return matches.filter(file => statSync(file).isFile());
  });
  const files = new Set([...inputs, ...expanded]), directories = new Set<string>(), paths = new Map<string, unknown>();
  const recordLinks = (path: string) => {
    for (let current = resolve(path); ; current = dirname(current)) {
      if (!paths.has(current)) {
        try { const stat = lstatSync(current); paths.set(current, stat.isSymbolicLink() ? ['symlink', readlinkSync(current)] : stat.isDirectory() ? ['directory'] : ['file']); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; paths.set(current, ['missing']); }
      }
      if (dirname(current) === current) break;
    }
  };
  const addDirectory = (directory: string) => { recordLinks(directory); if (existsSync(directory) && statSync(directory).isDirectory()) directories.add(directory); };
  const addCandidate = (path: string) => { recordLinks(path); addDirectory(dirname(path)); };
  for (const dependency of expanded) {
    let directory = dirname(resolve(dependency));
    addDirectory(directory);
    if (dependency.endsWith('.css') && existsSync(dependency)) {
      const css = readFileSync(dependency, 'utf8');
      if (/@(?:config|plugin)\b/.test(css)) throw Error('动态 CSS 构建配置不能确认完整读取边界');
      for (const match of css.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/g)) if (!/^(?:https?:|data:)/.test(match[1]!)) resolutions.push([match[1]!, dirname(dependency)]);
    }
    while (true) {
      const metadata = join(directory, 'package.json');
      files.add(metadata); files.add(join(directory, 'tsconfig.json'));
      if (existsSync(metadata)) {
        if (directory !== root && !directory.startsWith(root + '/src/')) for (const file of treeFiles(directory)) files.add(file);
        break;
      }
      const parent = dirname(directory); if (parent === directory) break; directory = parent;
    }
  }
  const configured = configurationTreeInputs([...files], root);
  for (const [specifier, importer] of resolutions) {
    if (typeof specifier !== 'string' || typeof importer !== 'string' || specifier.startsWith('#')) throw Error('导入解析边界不确定');
    if (specifier.startsWith('.') || isAbsolute(specifier)) addCandidate(resolve(importer, specifier));
    else {
      const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!;
      for (let directory = resolve(importer); ; directory = dirname(directory)) {
        const modules = join(directory, 'node_modules'), candidate = join(modules, packageName);
        addDirectory(modules); addDirectory(dirname(candidate)); addDirectory(candidate); files.add(join(candidate, 'package.json'));
        if (dirname(directory) === directory) break;
      }
      if (specifier.startsWith('@/')) {
        const candidate = resolve(root, 'src/panel', specifier.slice(2));
        if (!candidate.startsWith(resolve(root, 'src/panel') + '/')) throw Error('alias 解析超出已确认源码边界');
        addCandidate(candidate);
      }
    }
  }
  const hash = createHash('sha256').update(JSON.stringify([...dependencies].sort())).update(fingerprint([...new Set([...configured, ...files])])).update(JSON.stringify([...paths].sort()));
  for (const directory of [...directories].sort()) {
    const members = readdirSync(directory, { withFileTypes: true }).filter(entry => !['test.js', 'test.css'].includes(entry.name)).map(entry => [entry.name, entry.isDirectory(), entry.isSymbolicLink() ? readlinkSync(join(directory, entry.name)) : null]).sort();
    hash.update(JSON.stringify([directory, members]));
  }
  return hash.digest('hex');
}

function artifactManifest(artifacts: Record<string, Uint8Array>) {
  return bytesIdentity(Buffer.from(JSON.stringify(Object.entries(artifacts).map(([file, bytes]) => [file, bytesIdentity(bytes)]).sort())));
}

type Built = { bytes: Uint8Array; dependencies?: string[]; artifacts?: Record<string, Uint8Array> };

/** 缓存只发布完整产物字节与输入身份，不能储存测试通过结论。 */
export class PersistentBuildCache {
  constructor(private root: string) { this.root = realpathSync(root); }
  async get(key: string, inputs: string[] | (() => string[]), compile: () => Promise<Built>) {
    const started = performance.now(); let buildMs = 0, cachePublishMs = 0;
    const compileTimed = async () => { const clock = performance.now(); try { return await compile(); } finally { buildMs += performance.now() - clock; } };
    const finish = <T extends object>(result: T) => ({ ...result, buildMs, cachePublishMs, cacheLookupMs: Math.max(0, performance.now() - started - buildMs - cachePublishMs) });
    if (process.env.CLAPGRID_BROWSER_BUILD_CACHE === '0') return finish({ ...(await compileTimed()), cacheHit: false, cacheReason: 'disabled', cacheKey: undefined });
    // 任意 Node 预载代码可改变真实工具行为，无法确认读取边界时只做真实构建。
    if (process.env.NODE_OPTIONS) return finish({ ...(await compileTimed()), cacheHit: false, cacheReason: 'unverified-runtime', cacheKey: undefined });
    const inputFiles = typeof inputs === 'function' ? inputs : () => inputs;
    const readInputs = () => [...inputFiles(), ...['ESBUILD_BINARY_PATH', 'BROWSERSLIST_CONFIG'].flatMap(name => process.env[name] ? [resolve(process.env[name]!)] : [])];
    const environment = { node: process.version, platform: process.platform, arch: process.arch,
      variables: Object.entries(process.env).filter(([name]) => /^(?:NODE_ENV|NODE_OPTIONS|ESBUILD_BINARY_PATH|BROWSERSLIST(?:_.*)?|TAILWIND_.*|VITE_.*)$/.test(name)).sort() };
    const directory = process.env.CLAPGRID_BROWSER_BUILD_CACHE_DIR ?? join(this.root, '.cache/browser-build');
    try { mkdirSync(directory, { recursive: true }); } catch { return finish({ ...(await compileTimed()), cacheHit: false, cacheReason: 'cache-unavailable', cacheKey: undefined }); }
    const lookupKey = bytesIdentity(Buffer.from(JSON.stringify([this.root, key, environment]))).slice(7);
    const inputKey = (fingerprint: string) => bytesIdentity(Buffer.from(JSON.stringify([lookupKey, fingerprint])));
    const entryPath = join(directory, `${lookupKey}.json`);
    let previousDependencies: string[] = [];
    try {
      const entry = JSON.parse(readFileSync(entryPath, 'utf8'));
      if (entry.schemaVersion === 3 && entry.root === this.root && entry.key === key && JSON.stringify(entry.environment) === JSON.stringify(environment)
        && Array.isArray(entry.dependencies) && entry.dependencies.every((file: unknown) => typeof file === 'string')) {
        previousDependencies = entry.dependencies;
        if (dependencyFingerprint(this.root, readInputs(), previousDependencies) === entry.fingerprint && entry.cacheKey === inputKey(entry.fingerprint)) {
          const bytes = Buffer.from(entry.bytes, 'base64');
          const artifacts: Record<string, Uint8Array> = {};
          if (!Array.isArray(entry.artifacts)) throw Error('产物集合不完整');
          for (const item of entry.artifacts) {
            if (typeof item.file !== 'string' || !item.file || item.file.includes('\\') || item.file.startsWith('/') || item.file.includes(':') || item.file.split('/').some((part: string) => !part || part === '.' || part === '..') || item.file.includes('\0') || artifacts[item.file]) throw Error('缓存产物路径无效');
            const artifact = Buffer.from(item.bytes, 'base64');
            if (bytesIdentity(artifact) !== item.identity) throw Error('缓存资源字节损坏');
            artifacts[item.file] = artifact;
          }
          if (artifactManifest(artifacts) !== entry.artifactsIdentity) throw Error('缓存产物清单损坏');
          if (bytesIdentity(bytes) === entry.identity) return finish({ bytes, artifacts, dependencies: previousDependencies, cacheHit: true, cacheReason: 'matched-inputs', cacheKey: entry.cacheKey });
        }
      }
    } catch { /* 缺失、损坏或无法核对的缓存回到真实构建。 */ }
    let baseBefore: string, before: string;
    try { baseBefore = fingerprint(readInputs()); before = dependencyFingerprint(this.root, readInputs(), previousDependencies); }
    catch { return finish({ ...(await compileTimed()), cacheHit: false, cacheReason: 'unverified-inputs', cacheKey: undefined }); }
    let result = await compileTimed();
    let dependencies = [...new Set(result.dependencies ?? [])].sort();
    let stable = false, verifiedFingerprint = '';
    try {
      if (JSON.stringify(dependencies) === JSON.stringify([...previousDependencies].sort())) { verifiedFingerprint = dependencyFingerprint(this.root, readInputs(), dependencies); stable = before === verifiedFingerprint; }
      else {
        // 首轮只发现实际依赖；先采集它们，再真实重建，避免用编译后才采集的新身份绑定旧字节。
        const observed = dependencyFingerprint(this.root, readInputs(), dependencies);
        const confirmed = await compileTimed();
        const confirmedDependencies = [...new Set(confirmed.dependencies ?? [])].sort();
        verifiedFingerprint = dependencyFingerprint(this.root, readInputs(), confirmedDependencies);
        stable = JSON.stringify(dependencies) === JSON.stringify(confirmedDependencies) && observed === verifiedFingerprint;
        result = confirmed; dependencies = confirmedDependencies;
      }
      stable &&= baseBefore === fingerprint(readInputs());
    } catch { /* 构建时新增/删除或不确定输入不能发布可命中的身份。 */ }
    if (stable) {
      const publicationStarted = performance.now();
      let temporary: string | undefined;
      try {
        const entry = { schemaVersion: 3, cacheKey: inputKey(verifiedFingerprint), artifactsIdentity: artifactManifest(result.artifacts ?? {}), root: this.root, key, environment, dependencies, artifacts: Object.entries(result.artifacts ?? {}).map(([file, bytes]) => ({ file, bytes: Buffer.from(bytes).toString('base64'), identity: bytesIdentity(bytes) })), fingerprint: verifiedFingerprint, bytes: Buffer.from(result.bytes).toString('base64'), identity: bytesIdentity(result.bytes) };
        mkdirSync(directory, { recursive: true });
        temporary = join(directory, `.${lookupKey}-${randomUUID()}.tmp`);
        writeFileSync(temporary, JSON.stringify(entry)); renameSync(temporary, entryPath);
      } catch { /* 缓存不可写不阻止实际构建和测试。 */ }
      finally { if (temporary) rmSync(temporary, { force: true }); cachePublishMs += performance.now() - publicationStarted; }
    }
    return finish({ ...result, cacheHit: false, cacheReason: stable ? 'rebuilt' : 'unstable-inputs', cacheKey: stable ? inputKey(verifiedFingerprint) : undefined });
  }
}
