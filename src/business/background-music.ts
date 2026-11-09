import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { addAbortSignal, type Readable } from 'node:stream';
import { mediaProcess } from './media-process.js';
import { verifyMedia } from './video-media.js';

export type BackgroundMusicSource = string | { name: string; bytes: Readable };
const maxBytes = 128 * 1024 * 1024;
const audioFormats = 'mp3,wav,flac,ogg,mov,aac,matroska,webm,aiff';

export function backgroundMusicPath(directory: string, id: string) {
  return join(directory, `${id}.background-music`);
}

export function backgroundMusicName(source: BackgroundMusicSource) {
  if (typeof source !== 'string') return source.name;
  if (!isAbsolute(source)) throw new Error('请提供用户明确指定的背景乐绝对路径');
  return basename(source);
}

export async function* backgroundMusicBytes(source: BackgroundMusicSource, signal: AbortSignal) {
  let size = 0;
  async function* chunks() {
    if (typeof source !== 'string') {
      yield* addAbortSignal(signal, source.bytes).iterator({ destroyOnReturn: false });
      return;
    }
    verifyMedia(source);
    const file = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1) throw new Error('背景乐来源必须是普通文件');
      yield* file.createReadStream({ autoClose: false, signal });
    } finally { await file.close(); }
  }
  for await (const chunk of chunks()) {
    signal.throwIfAborted();
    size += chunk.length;
    if (size > maxBytes) throw new Error('背景乐文件不得超过 128 MiB');
    yield chunk;
  }
}

export async function decodeBackgroundMusic(path: string, signal: AbortSignal, output?: { path: string; duration: number }) {
  try {
    verifyMedia(path);
    // 完整解码用于校验，只把全片时长内可用的采样写入导出工作目录。
    const pcm = output ? ['-map', '0:a:0', '-af', `aresample=48000,atrim=end_sample=${Math.round(output.duration * 48000)},asetpts=N/SR/TB`,
      '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', '-f', 's16le', output.path] : [];
    await mediaProcess('ffmpeg', ['-v', 'error', '-nostdin', '-xerror', '-abort_on', 'empty_output',
      '-protocol_whitelist', 'file,pipe', '-format_whitelist', audioFormats, '-i', path, ...pcm, '-map', '0:a:0', '-f', 'null', '-',
    ], { signal });
  } catch (error) {
    signal.throwIfAborted();
    throw new Error('背景乐不可读或不可解码，请重新导入可播放的音频文件', { cause: error });
  }
}
