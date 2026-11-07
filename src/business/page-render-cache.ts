import { createHash } from 'node:crypto';
import { linkSync, realpathSync, unlinkSync } from 'node:fs';
import { lstat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pageBrowserVersion } from './page-browser.js';
import { verifyMedia } from './video-media.js';
import { runPageWorker, type PageWorkerInput } from './page-worker-input.js';

export async function renderCachedPage(input: PageWorkerInput, assetsIdentity: Record<string, string>, config: string, signal: AbortSignal) {
  const { output, projectDirectory, assets, ...content } = input;
  const key = createHash('sha256').update(JSON.stringify([1, pageBrowserVersion, content, assetsIdentity])).digest('hex');
  const cache = join(projectDirectory, '.cache');
  const directory = join(cache, 'rendered-layers');
  const verifyDirectory = (path: string) => {
    if (realpathSync(path) !== path) throw new Error('渲染缓存目录不能是符号链接');
  };
  for (const path of [cache, directory]) {
    await mkdir(path, { recursive: true });
    verifyDirectory(path);
  }
  const file = join(directory, key + '.mkv');
  const exists = await lstat(file).then(() => true, error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  if (exists) {
    verifyDirectory(directory);
    verifyMedia(file);
    return file;
  }
  // 任务临时目录负责回收取消和失败的产物，编码完成后才原子发布缓存。
  await runPageWorker({ ...input, assets }, config, signal);
  signal.throwIfAborted();
  verifyDirectory(directory);
  try { linkSync(output, file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    verifyMedia(file);
    return file;
  }
  unlinkSync(output);
  return file;
}
