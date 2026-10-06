import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const identityEntries = ['dist/business/media-worker.js', 'dist/runtime.js', 'dist/service/main.js', 'dist/mcp/main.js'];
const prefix = 'const __CLAPGRID_BUILD_IDENTITY__ = ';
export const identityBanner = identity => `${prefix}${JSON.stringify(identity)};\n`;

// 指纹覆盖整个包的路径和字节，仅排除元数据文件和固定入口的身份注入行，避免自引用。
export async function pluginFingerprint(directory) {
  const hash = createHash('sha256');
  async function walk(relative = '') {
    const entries = await readdir(join(directory, relative), { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (path === 'build-identity.json') continue;
      if (entry.isDirectory()) { await walk(path); continue; }
      if (!entry.isFile()) throw new Error('插件包包含非普通文件');
      let bytes = await readFile(join(directory, path));
      if (identityEntries.includes(path) && bytes.subarray(0, prefix.length).toString() === prefix) {
        const end = bytes.indexOf(10);
        if (end === -1) throw new Error('身份注入行无效');
        bytes = bytes.subarray(end + 1);
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
    if (value.schemaVersion !== 1 || value.state !== 'known' || typeof value.version !== 'string'
      || !/^sha256:[a-f0-9]{64}$/.test(value.contentFingerprint) || !value.source
      || !['clean', 'dirty', 'unknown'].includes(value.source.state)
      || !(value.source.commit === null || /^[a-f0-9]{40,64}$/.test(value.source.commit))) return unknown;
    const identity = { schemaVersion: 1, state: 'known', version: value.version,
      source: { commit: value.source.commit, state: value.source.state }, contentFingerprint: value.contentFingerprint };
    if (await pluginFingerprint(directory) !== identity.contentFingerprint) return unknown;
    for (const entry of identityEntries) {
      if (!(await readFile(join(directory, entry), 'utf8')).startsWith(identityBanner(identity))) return unknown;
    }
    return identity;
  } catch { return unknown; }
}
