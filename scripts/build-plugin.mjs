import { build } from 'esbuild';
import { cp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { execFileSync } from 'node:child_process';
import { identityEntries, identityBanner, panelIdentityBanner, pluginFingerprint } from './plugin-identity.mjs';

let source = { commit: null, state: 'unknown' };
try {
  source = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
    state: execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8' }).trim() ? 'dirty' : 'clean' };
} catch { /* 无 Git 来源的构建保留未知，不以版本替代。 */ }
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const destination = resolve('dist/plugin/clapgrid');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp('plugins/clapgrid', destination, { recursive: true });
// Linux 的 MCP 使用同一组件选择器，使用户级安装的 Node 无需改写系统 PATH。
if (process.platform === 'linux') {
  await writeFile(`${destination}/.mcp.json`, JSON.stringify({ mcpServers: { clapgrid: {
    command: 'bash', args: ['scripts/runtime-linux.sh', 'mcp'], cwd: '.',
    env_vars: ['CLAPGRID_CODEX_BIN', 'CLAPGRID_RUNTIME_HOME', 'XDG_DATA_HOME'],
  } } }, null, 2));
}
await writeFile(`${destination}/package.json`, JSON.stringify({ name: 'clapgrid', version, private: true, type: 'module' }));
await cp('dist/panel', `${destination}/dist/panel`, { recursive: true });
await build({
  entryPoints: ['src/business/media-worker.ts', 'src/runtime.ts', 'src/service/main.ts', 'src/mcp/main.ts'],
  outbase: 'src', outdir: `${destination}/dist`, bundle: true, platform: 'node',
  format: 'esm', target: 'node22', external: ['vite'],
  banner: { js: "import { createRequire as clapgridCreateRequire } from 'node:module'; const require = clapgridCreateRequire(import.meta.url);" },
});
const manifestPath = `${destination}/.codex-plugin/plugin.json`;
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.version = version;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
const contentVersion = `${version.split('+')[0]}+git.${source.commit?.slice(0, 12) ?? 'unknown'}.${(await pluginFingerprint(destination)).slice(7, 19)}`;
manifest.version = contentVersion;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
await writeFile(`${destination}/package.json`, JSON.stringify({ name: 'clapgrid', version: contentVersion, private: true, type: 'module' }));
const identity = { schemaVersion: 1, state: 'known', version: contentVersion, source, contentFingerprint: await pluginFingerprint(destination) };
for (const entry of identityEntries) {
  const file = `${destination}/${entry}`;
  await writeFile(file, identityBanner(identity) + await readFile(file, 'utf8'));
}
const panelFile = `${destination}/dist/panel/index.html`;
const panel = await readFile(panelFile, 'utf8');
const doctype = panel.match(/^<!doctype[^>]*>/i)?.[0] ?? '';
await writeFile(panelFile, doctype + panelIdentityBanner(identity) + panel.slice(doctype.length));
await writeFile(`${destination}/build-identity.json`, JSON.stringify(identity, null, 2) + '\n');
console.log(`插件构建完成：${destination}`);
