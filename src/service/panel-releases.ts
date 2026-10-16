import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { buildIdentity, compatibleRuntime, type BuildIdentity } from '../build-identity.js';
import { readPluginIdentity, panelFilesFingerprint } from '../plugin-package.mjs';

export type PanelRelease = { identity: BuildIdentity; files: Map<string, Buffer> };
/** 每次先完整读取并校验不可变包，再一次性发布快照；请求不会看到半个发布。 */
export async function loadPanelRelease(directory: string, project: string): Promise<PanelRelease> {
  const absolute = resolve(directory);
  const projectRelative = relative(resolve(project), absolute);
  const insideProject = projectRelative === '' || (!isAbsolute(projectRelative) && projectRelative !== '..' && !projectRelative.startsWith('..' + sep));
  if (directory !== absolute || await realpath(absolute) !== absolute || insideProject) throw new Error('面板发布不能来自项目目录或符号链接');
  async function plain(path: string) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('面板发布包含非普通文件');
    if (stat.isDirectory()) for (const entry of await readdir(path)) await plain(join(path, entry));
  }
  const identity = await readPluginIdentity(absolute);
  if (identity.state !== 'known' || identity.schemaVersion !== 2 || !compatibleRuntime(identity, buildIdentity)) throw new Error('面板发布运行时或协议不兼容，需要完整插件更新');
  await plain(absolute);
  const files = new Map<string, Buffer>();
  const panel = join(absolute, 'dist/panel');
  async function collect(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) await collect(full);
      else files.set('/' + relative(panel, full).replaceAll('\\', '/'), await readFile(full));
    }
  }
  await collect(panel);
  if (panelFilesFingerprint(files) !== identity.panelFingerprint) throw new Error('读入的面板快照与发布指纹不符');
  if (!files.has('/index.html')) throw new Error('面板发布缺少入口');
  // 二次核对避免读取期间包发生变化；发布仅使用已读取字节。
  const after = await readPluginIdentity(absolute);
  if (after.state !== 'known' || after.contentFingerprint !== identity.contentFingerprint) throw new Error('面板发布在读取期间发生变化');
  return { identity, files };
}

export function panelDocument(bytes: Buffer, identity: BuildIdentity) {
  if (identity.state !== 'known' || identity.schemaVersion !== 2 || !identity.panelFingerprint) return bytes;
  const base = `/panel-release/${identity.panelFingerprint.slice(7)}/`;
  // Vite 根资源URL改为不可变代次；绑定API仍以原页面地址访问。
  return Buffer.from(bytes.toString().replaceAll('"/assets/', `"${base}assets/`).replaceAll("'/assets/", `'${base}assets/`).replaceAll('url(/assets/', `url(${base}assets/`));
}
