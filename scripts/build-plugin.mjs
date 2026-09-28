import { build } from 'esbuild';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const destination = resolve('dist/plugin/clapgrid');
await mkdir(destination, { recursive: true });
await cp('plugins/clapgrid', destination, { recursive: true });
// Linux 的 MCP 使用同一组件选择器，使用户级安装的 Node 无需改写系统 PATH。
if (process.platform === 'linux') {
  await writeFile(`${destination}/.mcp.json`, JSON.stringify({ mcpServers: { clapgrid: {
    command: 'bash', args: ['scripts/runtime-linux.sh', 'mcp'], cwd: '.',
    env_vars: ['CLAPGRID_SERVICE_URL', 'CLAPGRID_RUNTIME_HOME', 'XDG_DATA_HOME'],
  } } }, null, 2));
}
await writeFile(`${destination}/package.json`, JSON.stringify({ name: 'clapgrid', version: '0.1.0', private: true, type: 'module' }));
await cp('dist/panel', `${destination}/dist/panel`, { recursive: true });
await build({
  entryPoints: ['src/business/media-worker.ts', 'src/runtime.ts', 'src/service/main.ts', 'src/mcp/main.ts'],
  outbase: 'src', outdir: `${destination}/dist`, bundle: true, platform: 'node',
  format: 'esm', target: 'node22', external: ['vite'],
  banner: { js: "import { createRequire as clapgridCreateRequire } from 'node:module'; const require = clapgridCreateRequire(import.meta.url);" },
});
console.log(`插件构建完成：${destination}`);
