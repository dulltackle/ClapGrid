import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { cardSchema } from './schema.mjs';
import { readManifest, resolveProjectFile, failure, statusOf } from './common.mjs';

const execute = promisify(execFile);
/** @param {string} command @param {string[]} args */
async function run(command, args) {
  return execute(command, args, { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
}
/** @typedef {{codec_type?:string,width?:number,height?:number,avg_frame_rate?:string,nb_read_frames?:string,duration?:string,channels?:number,sample_rate?:string,start_time?:string}} Stream */
/** @param {string} file @returns {Promise<{streams:Stream[],format:{duration?:string}}>} */
async function probe(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file]);
  return JSON.parse(stdout.toString());
}
/** @param {string} file @param {number} sampleRate @param {number} channels */
async function pcm(file, sampleRate, channels) {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-xerror', '-nostdin', '-i', file, '-map', '0:a:0', '-vn', '-ar', String(sampleRate), '-ac', String(channels), '-f', 's16le', '-']);
  return stdout;
}
/** @param {Buffer} expected @param {Buffer} actual @param {number} sampleRate @param {number} channels */
function audioComparison(expected, actual, sampleRate, channels) {
  const count = Math.max(expected.length, actual.length) / 2;
  let difference = 0, energy = 0;
  for (let index = 0; index < count; index++) {
    const source = index * 2 < expected.length ? expected.readInt16LE(index * 2) : 0;
    const output = index * 2 < actual.length ? actual.readInt16LE(index * 2) : 0;
    difference += (source - output) ** 2; energy += source ** 2;
  }
  return { sourceSha256: createHash('sha256').update(expected).digest('hex'), reviewSha256: createHash('sha256').update(actual).digest('hex'), sourceSamples: expected.length / 2 / channels, reviewSamples: actual.length / 2 / channels, sampleRate, channels, normalizedError: energy === 0 ? (difference === 0 ? 0 : 1) : Math.sqrt(difference / energy) };
}

/** @param {import('./common.mjs').CommandOptions} options @returns {Promise<import('./common.mjs').CommandResult>} */
export default async function check(options) {
  /** @type {import('./common.mjs').Check[]} */
  const checks = [];
  let loaded;
  try { loaded = await readManifest(options); checks.push({ id: 'manifest', status: 'passed', message: '清单结构及稳定片段身份有效', path: loaded.path }); }
  catch (error) { return { command: 'check', status: 'failed', checks: [failure('manifest', String(error), options.manifest)] }; }
  const { manifest } = loaded;
  const { width, height, fps } = manifest.project;
  try {
    const configPath = await resolveProjectFile(options.project, manifest.typecheck);
    const compiler = resolve(dirname(fileURLToPath(import.meta.resolve('typescript/package.json'))), 'bin/tsc');
    const scratch = await mkdtemp(resolve(tmpdir(), 'clapgrid-production-types-'));
    let stdout;
    try {
      ({ stdout } = await execute(process.execPath, [compiler, '--project', configPath, '--noEmit', '--allowJs', '--checkJs', '--noCheck', 'false', '--incremental', '--tsBuildInfoFile', resolve(scratch, 'cache.info'), '--listFiles', '--pretty', 'false'], { cwd: options.project, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
    } finally { await rm(scratch, { recursive: true, force: true }); }
    const included = new Set(stdout.trim().split(/\r?\n/).map(file => resolve(options.project, file)));
    for (const segment of manifest.segments) {
      const source = await resolveProjectFile(options.project, segment.source);
      if (!included.has(source)) throw new Error(`制作源文件未被类型检查覆盖：${segment.source}`);
    }
    checks.push({ id: 'production-types', status: 'passed', message: '制作源文件已覆盖并通过锁定 TypeScript 检查', path: manifest.typecheck });
  } catch (error) {
    const diagnostics = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
    checks.push(failure('production-types', `${String(error)}${diagnostics ? `\n${diagnostics}` : ''}`, manifest.typecheck));
  }
  let tools = true;
  for (const tool of ['ffmpeg', 'ffprobe']) {
    try { const result = await run(tool, ['-version']); checks.push({ id: tool, status: 'passed', message: result.stdout.toString().split('\n')[0] ?? tool }); }
    catch (error) { tools = false; checks.push(failure(tool, `媒体工具未执行：${String(error)}`)); }
  }
  for (const segment of manifest.segments) {
    const id = segment.id;
    /** @type {Record<string,string>} */
    const files = {};
    let paths = true;
    for (const role of /** @type {const} */ (['card', 'source', 'audio', 'assembly', 'review'])) {
      try { files[role] = await resolveProjectFile(options.project, segment[role]); checks.push({ id: `${id}:${role}:path`, status: 'passed', message: '项目文件存在', path: segment[role] }); }
      catch (error) { paths = false; checks.push(failure(`${id}:${role}:path`, String(error), segment[role])); }
    }
    try {
      if (!files.card) throw new Error('制作卡缺失，映射未执行');
      const card = cardSchema.parse(JSON.parse(await readFile(files.card, 'utf8')));
      const mapping = card.segments.filter(entry => entry.id === id);
      if (mapping.length !== 1 || mapping[0]?.source !== segment.source || mapping[0]?.audio !== segment.audio) throw new Error('制作卡稳定片段身份、源文件或配音映射不匹配');
      checks.push({ id: `${id}:mapping`, status: 'passed', message: '制作卡与清单的源文件及配音映射一致', path: segment.card });
    } catch (error) { checks.push(failure(`${id}:mapping`, String(error), segment.card)); }
    if (!tools || !paths) { checks.push({ id: `${id}:media`, status: 'pending', message: '工具或引用缺失，媒体检查未执行' }); continue; }
    for (const role of /** @type {const} */ (['audio', 'assembly', 'review'])) {
      const file = files[role];
      if (!file) continue;
      try {
        const metadata = await probe(file);
        const video = metadata.streams.filter(stream => stream.codec_type === 'video');
        const audio = metadata.streams.filter(stream => stream.codec_type === 'audio');
        if (role === 'audio' ? audio.length !== 1 || video.length !== 0 : video.length !== 1 || audio.length !== (role === 'review' ? 1 : 0)) throw new Error(`轨道要求不满足：video=${video.length},audio=${audio.length}`);
        if (metadata.streams.length !== video.length + audio.length) throw new Error('包含未声明的其他轨道');
        if (role !== 'audio') {
          const stream = video[0];
          const rate = stream?.avg_frame_rate?.split('/').map(Number) ?? [];
          if (stream?.width !== width || stream?.height !== height || !rate[0] || !rate[1] || Math.abs(rate[0] / rate[1] - fps) > 0.0001 || Number(stream.nb_read_frames) !== segment.frames) throw new Error(`尺寸、帧率或帧长不匹配：${JSON.stringify(stream)}`);
        }
        const duration = Number(metadata.format.duration);
        if (!Number.isFinite(duration) || Math.abs(duration - segment.frames / fps) > 1 / fps + 0.01) throw new Error(`媒体时长与片段帧长不符：${duration}s，预期${segment.frames / fps}s`);
        await run('ffmpeg', ['-v', 'error', '-xerror', '-nostdin', '-i', file, '-map', '0', '-f', 'null', '-']);
        checks.push({ id: `${id}:${role}:media`, status: 'passed', message: '轨道、参数、帧长与完整解码通过', path: segment[role], metadata });
      } catch (error) { checks.push(failure(`${id}:${role}:media`, String(error), segment[role])); }
    }
    try {
      if (!files.audio || !files.review) throw new Error('配音或审阅素材缺失');
      const sourceAudio = (await probe(files.audio)).streams.find(stream => stream.codec_type === 'audio');
      const reviewMetadata = await probe(files.review);
      const reviewAudio = reviewMetadata.streams.find(stream => stream.codec_type === 'audio');
      const reviewVideo = reviewMetadata.streams.find(stream => stream.codec_type === 'video');
      const channels = sourceAudio?.channels;
      const sampleRate = Number(sourceAudio?.sample_rate);
      if (!channels || !sampleRate || channels !== reviewAudio?.channels) throw new Error('审阅音轨声道数量与配音不符，或配音采样参数无效');
      const comparison = audioComparison(await pcm(files.audio, sampleRate, channels), await pcm(files.review, sampleRate, channels), sampleRate, channels);
      const audioStart = Number(reviewAudio.start_time), videoStart = Number(reviewVideo?.start_time);
      if (!Number.isFinite(audioStart) || !Number.isFinite(videoStart)) throw new Error('缺少音频或视频轨道起始时间，无法核对恢复时间线');
      const timelineOffsetSeconds = audioStart - videoStart;
      // 容器毫秒刻度与一个音频样本的量化余量，不能复用视频帧长容差接受延迟。
      const maxTimelineOffsetSeconds = 0.001 + 1 / sampleRate;
      const tolerance = manifest.project.audio?.maxNormalizedError ?? 0.05;
      const durationMatches = Math.abs(comparison.sourceSamples - comparison.reviewSamples) / comparison.sampleRate <= 1 / fps + 0.01;
      const matches = comparison.sourceSamples > 0 && durationMatches && comparison.normalizedError <= tolerance && Math.abs(timelineOffsetSeconds) <= maxTimelineOffsetSeconds;
      checks.push({ id: `${id}:audio-correspondence`, status: matches ? 'passed' : 'failed', message: matches ? '审阅音轨与实际配音解码样本及时间线对应' : '审阅音轨与配音错位、时长不同或内容不符', path: segment.review, comparison: { ...comparison, audioStart, videoStart, timelineOffsetSeconds, maxTimelineOffsetSeconds }, tolerance });
    } catch (error) { checks.push(failure(`${id}:audio-correspondence`, String(error), segment.review)); }
  }
  return { command: 'check', status: statusOf(checks), checks, details: { segments: manifest.segments.map(segment => segment.id), scope: 'offline', actualHost: 'pending', validSpeech: 'pending', fullExport: 'pending', note: '离线检查不证明宿主装配、配音输入快照有效性或实际全片导出；这三项需本机验收。' } };
}
