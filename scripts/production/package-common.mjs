import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readManifest, failure } from './common.mjs';

/** @param {'pack'|'verify-package'} command @param {import('./common.mjs').CommandOptions} options
 * @returns {Promise<import('./common.mjs').CommandResult>} */
export async function archiveCommand(command, options) {
  await readManifest(options);
  return new Promise(resolve => {
    const child = execFile('python3', [fileURLToPath(new URL('./archive.py', import.meta.url))], { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) { resolve({ command, status: 'failed', checks: [failure('archive-tool', `${error.message} ${stderr}`)] }); return; }
      try { resolve(JSON.parse(stdout)); }
      catch { resolve({ command, status: 'failed', checks: [failure('archive-report', '归档工具没有返回有效报告')] }); }
    });
    child.stdin?.end(JSON.stringify({ command, ...options }));
  });
}
