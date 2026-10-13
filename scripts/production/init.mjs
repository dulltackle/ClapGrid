import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const template = fileURLToPath(new URL('../../docs/templates/video.md', import.meta.url));

/** @param {{project:string}} options @returns {Promise<import('./common.mjs').CommandResult>} */
export default async function init({ project }) {
  const document = join(project, 'video.md');
  if (!(await stat(project)).isDirectory()) throw new Error(`项目根目录不是目录：${project}`);
  let created = false;
  try {
    await writeFile(document, await readFile(template, 'utf8'), { flag: 'wx' });
    created = true;
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw error;
    if (!(await stat(document)).isFile()) throw new Error(`已有制作约定不是文件：${document}`);
  }
  return {
    command: 'init', status: 'passed',
    checks: [{ id: 'video-document', status: 'passed', path: document, message: created ? '已初始化项目制作约定。' : '已有制作约定已保留。' }],
    details: { document, template, created },
  };
}
