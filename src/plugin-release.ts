import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { buildIdentity, buildIdentitySchema } from './build-identity.js';

/** 更新收据只描述安装目标，不替代宿主和服务进程的实测身份。 */
export async function verifyLoadedPlugin() {
  if (buildIdentity.state !== 'known') return;
  const path = join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'clapgrid/plugin-update.json');
  let receipt;
  try { receipt = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw new Error('插件更新记录不可读取，请执行更新诊断。'); }
  const desired = buildIdentitySchema.safeParse(receipt.identity);
  if (!desired.success || desired.data.state !== 'known') throw new Error('插件更新记录无效，请执行更新诊断。');
  if (desired.data.contentFingerprint !== buildIdentity.contentFingerprint) throw new Error('插件版本已过时，请重载 ClapGrid 插件后重新打开。');
  if (typeof receipt.sourceRepository === 'string' && buildIdentity.source.commit) {
    try {
      await promisify(execFile)('git', ['-C', receipt.sourceRepository, 'diff', '--quiet', buildIdentity.source.commit, 'HEAD', '--',
        'src', 'plugins', 'scripts/build-plugin.mjs', 'scripts/plugin-identity.mjs', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.build.json'], { timeout: 3000 });
    } catch (error) {
      if ((error as { code?: number }).code === 1) throw new Error('插件源码已有更新，当前安装仍是旧构建，请执行插件更新流程。');
      throw new Error('插件源码版本无法核对，请检查更新记录中的本地仓库。');
    }
  }
}
