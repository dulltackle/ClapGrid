import { appendFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, version as esbuildVersion } from 'esbuild';
import type { TestContext } from 'node:test';
import { PersistentBuildCache, configurationTreeInputs, bindBuildTools, fingerprint, treeFiles, bytesIdentity } from './persistent-build-cache.js';
export { fingerprint, treeFiles, bytesIdentity } from './persistent-build-cache.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

/** 只在当前测试进程内复用产物，每次命中前重新核对实际读取的依赖内容。 */
export class MemoryBuildCache {
  private entries = new Map<string, { bytes: Uint8Array; dependencies: string[]; fingerprint: string }>();
  async get(key: string, inputs: string[], compile: () => Promise<{ bytes: Uint8Array; dependencies?: string[] }>) {
    if (process.env.CLAPGRID_BROWSER_BUILD_CACHE === '0') return { ...(await compile()), cacheHit: false };
    const previous = this.entries.get(key);
    if (previous && fingerprint([...inputs, ...previous.dependencies]) === previous.fingerprint) return { bytes: previous.bytes, cacheHit: true };
    const sourceBefore = fingerprint(inputs);
    const result = await compile();
    const dependencies = result.dependencies ?? [];
    if (sourceBefore === fingerprint(inputs)) this.entries.set(key, { ...result, dependencies, fingerprint: fingerprint([...inputs, ...dependencies]) });
    else this.entries.delete(key);
    return { bytes: result.bytes, cacheHit: false };
  }
}

export function buildConfigurationInputs() {
  return configurationTreeInputs(readdirSync(root).filter(file => /(?:^package(?:-lock)?\.json$|^tsconfig.*\.json$|(?:^|\.)config\.[cm]?[jt]s$|^\.(?:browserslistrc|npmrc)$)/.test(file)).map(file => join(root, file)), root);
}
export const buildEnvironmentInputs = [join(root, 'package.json'), join(root, 'package-lock.json')];
const scripts = new PersistentBuildCache(root);
const verifiedTools = bindBuildTools(root, ['esbuild', 'tsx']);

export async function buildBrowserScript(directory: string, script: string, fixture: string, buildDefine: Record<string, string> = {}) {
  const define = { 'process.env.NODE_ENV': '"development"', ...buildDefine };
  const key = JSON.stringify([script, fixture, define, esbuildVersion, process.version, 'development-iife-automatic-v1']);
  const result = await scripts.get(key, () => [...verifiedTools.cacheInputs(), ...buildConfigurationInputs(), ...buildEnvironmentInputs, ...treeFiles(join(root, 'src')), ...treeFiles(join(root, 'tests/helpers'))], async () => {
    verifiedTools();
    const resolutions: string[] = [];
    const output = await build({
      absWorkingDir: root,
      stdin: { resolveDir: root, loader: 'tsx', contents: script },
      bundle: true, jsx: 'automatic', format: 'iife', write: false, metafile: true, outfile: join(root, 'browser-test.js'),
      define,
      plugins: [{ name: 'http-fixture', setup(builder) {
        builder.onResolve({ filter: /^(editing-fixture|\.\.\/shared\/client\.js)$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture, loader: 'js' }));
      } }, { name: 'record-import-resolution', setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => { if (args.resolveDir && args.namespace !== 'fixture') resolutions.push(`resolve:${JSON.stringify([args.path, args.resolveDir])}`); return undefined; });
      } }],
    });
    verifiedTools();
    const dependencies = Object.keys(output.metafile!.inputs).filter(path => !path.startsWith('fixture:') && path !== '<stdin>').map(path => resolve(root, path));
    // 每次命中还检查整个源码树，新增文件或 import 解析目标变化不能沿用旧包。
    return { bytes: output.outputFiles!.find(file => file.path.endsWith('.js'))!.contents, dependencies: [...dependencies, ...resolutions] };
  });
  verifiedTools();
  writeFileSync(join(directory, 'test.js'), result.bytes);
  return { cacheHit: result.cacheHit, identity: bytesIdentity(result.bytes), cacheReason: result.cacheReason, cacheKey: result.cacheKey, cacheLookupMs: result.cacheLookupMs, buildMs: result.buildMs, cachePublishMs: result.cachePublishMs };
}

export type BrowserTimings = Record<string, number | boolean | string>;
export function recordBrowserTimings(t: TestContext, timings: BrowserTimings) {
  const record = { test: t.name, pid: process.pid, ...timings };
  t.diagnostic(`browser-timings ${JSON.stringify(record)}`);
  const target = process.env.CLAPGRID_BROWSER_TIMINGS;
  if (target) appendFileSync(target, JSON.stringify(record) + '\n');
}
