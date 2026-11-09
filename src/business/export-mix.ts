import { open, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { mediaProcess } from './media-process.js';

const sampleRate = 48_000;
const blockSamples = 960; // 20 毫秒，同时作为压低音乐的前瞻时间。
const releaseSeconds = 0.25;
const maxMusicGain = 0.25;
const speechThreshold = 10 ** (-50 / 20) * 32768;
const speechToMusic = 10 ** (10 / 20);

async function readExactly(file: FileHandle, buffer: Buffer, offset: number, length: number, position: number) {
  const end = offset + length;
  while (offset < end) {
    const { bytesRead } = await file.read(buffer, offset, end - offset, position);
    if (!bytesRead) throw new Error('混音输入意外结束');
    offset += bytesRead;
    position += bytesRead;
  }
}

export async function mixExportAudio(input: string[], backgroundMusic: string, directory: string, signal: AbortSignal) {
  const speechPath = join(directory, 'export-speech.pcm');
  await mediaProcess('ffmpeg', ['-v', 'error', '-nostdin', '-xerror', ...input, '-map', '0:a:0',
    '-ar', String(sampleRate), '-ac', '1', '-c:a', 'pcm_s16le', '-f', 's16le', speechPath], { cwd: directory, signal });
  const handles: FileHandle[] = [];
  async function openPcm(path: string, flags: 'r' | 'wx') {
    const handle = await open(path, flags);
    handles.push(handle);
    return handle;
  }

  try {
    const speech = await openPcm(speechPath, 'r');
    const music = await openPcm(backgroundMusic, 'r');
    const totalSamples = (await speech.stat()).size / 2;
    const musicBytes = (await music.stat()).size;
    if (!totalSamples || !musicBytes) throw new Error('混音输入没有音频采样');
    const fadeSamples = Math.min(sampleRate, totalSamples / 2);
    const mixedPath = join(directory, 'export-mix.pcm');
    const mixed = await openPcm(mixedPath, 'wx');
    const output = Buffer.alloc(blockSamples * 8);
    const makeBlock = () => ({ voice: Buffer.alloc(blockSamples * 2), track: Buffer.alloc(blockSamples * 4), samples: 0, target: maxMusicGain });

    async function readBlock(block: ReturnType<typeof makeBlock>, start: number) {
      signal.throwIfAborted();
      const samples = Math.min(blockSamples, totalSamples - start);
      block.samples = samples;
      if (!samples) { block.target = maxMusicGain; return; }
      await readExactly(speech, block.voice, 0, samples * 2, start * 2);
      const position = (start * 4) % musicBytes;
      const period = Math.min(samples * 4, musicBytes);
      const leading = Math.min(period, musicBytes - position);
      await readExactly(music, block.track, 0, leading, position);
      if (leading < period) await readExactly(music, block.track, leading, period - leading, 0);
      if (period < samples * 4) block.track.fill(block.track.subarray(0, period), period, samples * 4);

      let voiceEnergy = 0; let musicEnergy = 0;
      for (let i = 0; i < samples; i++) {
        voiceEnergy += block.voice.readInt16LE(i * 2) ** 2;
        musicEnergy += (block.track.readInt16LE(i * 4) ** 2 + block.track.readInt16LE(i * 4 + 2) ** 2) / 2;
      }
      block.target = voiceEnergy >= samples * speechThreshold ** 2 && musicEnergy > 0
        ? Math.min(maxMusicGain, Math.sqrt(voiceEnergy / musicEnergy) / speechToMusic)
        : maxMusicGain;
    }

    let current = makeBlock(); let next = makeBlock();
    await readBlock(current, 0);
    let gain = current.target;
    for (let start = 0; start < totalSamples; start += blockSamples) {
      const samples = current.samples;
      await readBlock(next, start + samples);
      // 下一块需要更低增益时提前压低；增益恢复时按固定时间常数渐变。
      const recovery = 1 - Math.exp(-samples / sampleRate / releaseSeconds);
      const endGain = Math.min(next.target, gain + (current.target - gain) * recovery);
      for (let i = 0; i < samples; i++) {
        const fade = Math.min(1, (totalSamples - 1 - start - i) / fadeSamples);
        const musicGain = (gain + (endGain - gain) * i / samples) * fade;
        const voice = current.voice.readInt16LE(i * 2);
        for (let channel = 0; channel < 2; channel++) {
          const sample = voice + current.track.readInt16LE(i * 4 + channel * 2) * musicGain;
          output.writeFloatLE(sample / 32768, i * 8 + channel * 4);
        }
      }
      await mixed.writeFile(output.subarray(0, samples * 8), { signal });
      gain = endGain;
      [current, next] = [next, current];
    }
    return ['-f', 'f32le', '-ar', String(sampleRate), '-ac', '2', '-i', mixedPath];
  } finally {
    const results = await Promise.allSettled(handles.map(file => file.close()));
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length) throw new AggregateError(failures, '无法关闭混音文件');
  }
}
