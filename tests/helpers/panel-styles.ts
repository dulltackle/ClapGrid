import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { MemoryBuildCache, buildEnvironmentInputs, bytesIdentity, treeFiles } from './browser-build.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const cache = new MemoryBuildCache();

/** 独立浏览器包使用生产同源样式与同版本 Vite/Tailwind 转换。 */
export async function buildPanelStyles(outDir: string) {
  const packages = ['vite', 'tailwindcss', '@tailwindcss/vite', '@tailwindcss/node', '@tailwindcss/oxide'];
  const versions = packages.map(name => join(root, 'node_modules', name, 'package.json'));
  const inputs = [...buildEnvironmentInputs, ...versions, ...treeFiles(join(root, 'src/panel')),
    ...treeFiles(join(root, 'node_modules/tailwindcss'))];
  const result = await cache.get(`production-panel-css-v1:${process.version}`, inputs, async () => {
    const dependencies: string[] = [];
    await build({
    configFile: false,
    root: fileURLToPath(new URL('../../src/panel', import.meta.url)),
    plugins: [tailwindcss(), { name: 'record-style-inputs', buildEnd() {
      for (const id of this.getModuleIds()) if (id.startsWith('/') && !id.includes('?')) dependencies.push(id);
    } }],
    logLevel: 'silent',
    build: {
      outDir, emptyOutDir: false,
      rolldownOptions: {
        input: fileURLToPath(new URL('../../src/panel/style.css', import.meta.url)),
        output: { assetFileNames: 'test.css' },
      },
    },
    });
    return { bytes: readFileSync(join(outDir, 'test.css')), dependencies };
  });
  if (result.cacheHit) writeFileSync(join(outDir, 'test.css'), result.bytes);
  return { cacheHit: result.cacheHit, identity: bytesIdentity(result.bytes) };
}
