import { build } from 'esbuild';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const destination = resolve('dist/plugin/clapgrid');
await mkdir(destination, { recursive: true });
await cp('plugins/clapgrid', destination, { recursive: true });
await writeFile(`${destination}/package.json`, JSON.stringify({ name: 'clapgrid', version: '0.1.0', private: true, type: 'module' }));
await cp('dist/panel', `${destination}/dist/panel`, { recursive: true });
await build({
  entryPoints: ['src/runtime.ts', 'src/service/main.ts', 'src/mcp/main.ts'],
  outbase: 'src', outdir: `${destination}/dist`, bundle: true, platform: 'node',
  format: 'esm', target: 'node22', external: ['vite'],
  banner: { js: "import { createRequire as clapgridCreateRequire } from 'node:module'; const require = clapgridCreateRequire(import.meta.url);" },
});
console.log(`插件构建完成：${destination}`);
