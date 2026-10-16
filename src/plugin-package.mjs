import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const identityEntries = ['dist/business/media-worker.js', 'dist/runtime.js', 'dist/service/main.js', 'dist/mcp/main.js'];
const prefix = 'const __CLAPGRID_BUILD_IDENTITY__ = ';
export const panelIdentityBanner = identity => `<script data-clapgrid-build>const __CLAPGRID_BUILD_IDENTITY__ = ${JSON.stringify(identity)};</script>\n`;
export const identityBanner = identity => `${prefix}${JSON.stringify(identity)};\n`;

// 指纹覆盖整个包的路径和字节，仅排除元数据文件和固定入口的身份注入行，避免自引用。
export async function pluginFingerprint(directory, { raw = false, partition = 'package' } = {}) {
  const hash = createHash('sha256');
  async function walk(relative = '') {
    const entries = await readdir(join(directory, relative), { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (!raw && path === 'build-identity.json') continue;
      if (entry.isDirectory()) { await walk(path); continue; }
      if (partition === 'panel' && !path.startsWith('dist/panel/')) continue;
      if (partition === 'runtime' && path.startsWith('dist/panel/')) continue;
      if (!entry.isFile()) throw new Error('插件包包含非普通文件');
      let bytes = await readFile(join(directory, path));
      if (!raw && identityEntries.includes(path) && bytes.subarray(0, prefix.length).toString() === prefix) {
        const end = bytes.indexOf(10);
        if (end === -1) throw new Error('身份注入行无效');
        bytes = bytes.subarray(end + 1);
      }
      if (!raw && path === 'dist/panel/index.html') bytes = Buffer.from(bytes.toString().replace(/^(<!doctype[^>]*>)?<script data-clapgrid-build>[^\n]*<\/script>\n/i, '$1'));
      if (partition === 'runtime' && ['package.json', '.codex-plugin/plugin.json'].includes(path)) {
        const metadata = JSON.parse(bytes.toString()); delete metadata.version; bytes = Buffer.from(JSON.stringify(metadata));
      }
      hash.update(`${Buffer.byteLength(path)}:${path}:${bytes.length}:`);
      hash.update(bytes);
    }
  }
  await walk();
  return `sha256:${hash.digest('hex')}`;
}

/** 读取磁盘包时必须重新核对内容与每个入口，不能只相信可复制的版本声明。 */
export async function readPluginIdentity(directory) {
  const unknown = { schemaVersion: 1, state: 'unknown' };
  try {
    const value = JSON.parse(await readFile(join(directory, 'build-identity.json'), 'utf8'));
    if (![1, 2].includes(value.schemaVersion) || value.state !== 'known' || typeof value.version !== 'string' || !/^[a-zA-Z0-9.+_-]+$/.test(value.version)
      || !/^sha256:[a-f0-9]{64}$/.test(value.contentFingerprint) || !value.source
      || !['clean', 'dirty', 'unknown'].includes(value.source.state)
      || !(value.source.commit === null || /^[a-f0-9]{40,64}$/.test(value.source.commit))) return unknown;
    const identity = { schemaVersion: value.schemaVersion, state: 'known', version: value.version,
      source: { commit: value.source.commit, state: value.source.state }, contentFingerprint: value.contentFingerprint, ...(value.schemaVersion === 2 ? { runtimeFingerprint: value.runtimeFingerprint, panelFingerprint: value.panelFingerprint, protocolVersion: value.protocolVersion } : {}) };
    if (value.schemaVersion === 2 && (identity.protocolVersion !== 1 || identity.runtimeFingerprint !== await pluginFingerprint(directory, { partition: 'runtime' }) || identity.panelFingerprint !== await pluginFingerprint(directory, { partition: 'panel' }))) return unknown;
    if (await pluginFingerprint(directory) !== identity.contentFingerprint) return unknown;
    for (const entry of identityEntries) {
      if (!(await readFile(join(directory, entry), 'utf8')).startsWith(identityBanner(identity))) return unknown;
    }
    const manifest = JSON.parse(await readFile(join(directory, '.codex-plugin/plugin.json'), 'utf8'));
    if (manifest.name !== 'clapgrid' || manifest.version !== identity.version) return unknown;
    if (!(await readFile(join(directory, 'dist/panel/index.html'), 'utf8')).replace(/^<!doctype[^>]*>/i, '').startsWith(panelIdentityBanner(identity))) return unknown;
    return identity;
  } catch { return unknown; }
}

/** 校验实际读入的快照，避免校验前后磁盘均有效但读取中混入其他字节。 */
export function panelFilesFingerprint(files) {
  const hash = createHash('sha256');
  for (const key of [...files.keys()].sort()) {
    const path = 'dist/panel' + key;
    let bytes = files.get(key);
    if (key === '/index.html') bytes = Buffer.from(bytes.toString().replace(/^(<!doctype[^>]*>)?<script data-clapgrid-build>[^\n]*<\/script>\n/i, '$1'));
    hash.update(`${Buffer.byteLength(path)}:${path}:${bytes.length}:`); hash.update(bytes);
  }
  return `sha256:${hash.digest('hex')}`;
}
