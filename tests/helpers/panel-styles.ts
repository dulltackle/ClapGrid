import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { join, dirname, resolve } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { PersistentBuildCache, bindBuildTools } from './persistent-build-cache.js';
import { buildConfigurationInputs, buildEnvironmentInputs, bytesIdentity, treeFiles } from './browser-build.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const cache = new PersistentBuildCache(root);
const packages = ['vite', 'tailwindcss', '@tailwindcss/vite', '@tailwindcss/node', '@tailwindcss/oxide'];
const verifiedTools = bindBuildTools(root, packages);

// Tailwind 向真实构建器登记扫描文件和 glob；同时保留它们以识别新增/删除扫描输入。
function withStyleDependencies(dependencies: string[]) {
  return tailwindcss().map(plugin => {
    const hook = plugin.transform;
    if (!hook) return plugin;
    const handler = typeof hook === 'function' ? hook : hook.handler;
    const wrapped = function(this: any, ...args: any[]) {
      const context = new Proxy(this, { get(target, property) {
        if (property === 'addWatchFile') return (file: string) => {
          const path = resolve(root, 'src/panel', file);
          dependencies.push(/[*?{[]/.test(file) ? `glob:${path}` : path);
          return target.addWatchFile(file);
        };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
      return handler.apply(context, args as any);
    };
    return { ...plugin, transform: typeof hook === 'function' ? wrapped : { ...hook, handler: wrapped } };
  });
}

// Vite 会自动向祖先寻找 PostCSS 配置；其中可执行代码的任意读取不在模块图中。
function assertStaticPostcssInputs() {
  for (let directory = join(root, 'src/panel'); ; directory = dirname(directory)) {
    if (readdirSync(directory).some(file => /^(?:postcss\.config\.|\.postcssrc(?:\.|$))/.test(file))) throw Error('动态 PostCSS 配置读取边界不确定');
    const metadata = join(directory, 'package.json');
    if (existsSync(metadata) && Object.hasOwn(JSON.parse(readFileSync(metadata, 'utf8')), 'postcss')) throw Error('package PostCSS 配置读取边界不确定');
    if (dirname(directory) === directory) break;
  }
}

/** 独立浏览器包使用生产同源样式与同版本 Vite/Tailwind 转换。 */
export async function buildPanelStyles(outDir: string) {
  const versions = packages.map(name => join(root, 'node_modules', name, 'package.json'));
  const inputs = () => { assertStaticPostcssInputs(); return [...verifiedTools.cacheInputs(), ...buildConfigurationInputs(), ...buildEnvironmentInputs, ...versions, ...treeFiles(join(root, 'src/panel')), ...treeFiles(join(root, 'tests/helpers')),
    ...treeFiles(join(root, 'node_modules/tailwindcss'))]; };
  const result = await cache.get(`production-panel-css-v1:${process.version}`, inputs, async () => {
    verifiedTools();
    const dependencies: string[] = [];
    const previousNodeEnv = process.env.NODE_ENV;
    const artifacts: Record<string, Uint8Array> = {};
    try { const built = await build({
    configFile: false,
    base: './',
    root: fileURLToPath(new URL('../../src/panel', import.meta.url)),
    plugins: [...withStyleDependencies(dependencies), { name: 'record-style-inputs', buildEnd() {
      for (const id of this.getModuleIds()) { const file = id.split('?')[0]!; if (file.startsWith('/') && existsSync(file) && statSync(file).isFile()) dependencies.push(file); }
    } }],
    logLevel: 'silent',
    build: {
      outDir, emptyOutDir: false, write: false,
      rolldownOptions: {
        input: fileURLToPath(new URL('../../src/panel/style.css', import.meta.url)),
        output: { assetFileNames: asset => asset.names.some(name => name.endsWith('.css')) ? 'test.css' : 'assets/[name]-[hash][extname]' },
      },
    },
    });
    for (const output of (Array.isArray(built) ? built.flatMap(item => item.output) : 'output' in built ? built.output : [])) {
      artifacts[output.fileName] = output.type === 'asset' ? typeof output.source === 'string' ? Buffer.from(output.source) : output.source : Buffer.from(output.code);
    }
    } finally { if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv; }
    verifiedTools();
    if (!artifacts['test.css']) throw Error('真实 CSS 构建未产生 test.css');
    return { bytes: artifacts['test.css'], artifacts, dependencies };
  });
  verifiedTools();
  for (const [file, bytes] of Object.entries(result.artifacts ?? {})) {
    const target = join(outDir, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes);
  }
  writeFileSync(join(outDir, 'test.css'), result.bytes);
  return { cacheHit: result.cacheHit, identity: bytesIdentity(result.bytes), cacheReason: result.cacheReason, cacheKey: result.cacheKey, cacheLookupMs: result.cacheLookupMs, buildMs: result.buildMs, cachePublishMs: result.cachePublishMs };
}
