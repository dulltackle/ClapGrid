import { randomUUID } from 'node:crypto';
import { constants, mkdirSync } from 'node:fs';
import { copyFile, link, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { ExportTask, ExportTasksStatus, ExportStatus, Snapshot, SpeechStatus } from '../shared/contracts.js';
import { validateVideo, verifyMedia } from './video-media.js';
import { assembleExport, prepareExportAudio, renderExportSegment, renderExportPreview, type RenderSegment } from './export-render.js';

type ExportInputs = {
  snapshot: () => Snapshot;
  settings: (signal?: AbortSignal) => Promise<ExportStatus>;
  busy: () => string[];
  speech: () => SpeechStatus;
  video: (id: string) => string;
  audio: (id: string) => string;
  verify: () => void;
};

/** 一次任务覆盖完整项目；任务生命周期独立于发起连接。 */
export function exportTasks(db: DatabaseSync, inputs: ExportInputs) {
  db.exec('CREATE TABLE IF NOT EXISTS export_tasks (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const tasks = (): ExportTask[] => db.prepare('SELECT value FROM export_tasks ORDER BY rowid').all().map(row => JSON.parse(String(row.value)));
  const save = (task: ExportTask) => { inputs.verify(); db.prepare('INSERT INTO export_tasks VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value').run(task.id, JSON.stringify(task)); };
  const directory = join(inputs.snapshot().project.directory, 'exports');
  let active: ExportTask | undefined;
  let running: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let closed = false;
  const assertUnlocked = () => { if (active) throw new Error('导出进行中，项目已锁定；可查询、试听和取消导出'); };
  const workPath = (task: ExportTask) => join(directory, `.work-${task.id}`);
  const previewPath = (task: ExportTask) => join(inputs.snapshot().storage.mediaDirectory, `${task.id}.export.webm`);
  const outputPath = (task: ExportTask) => join(directory, `${task.createdAt.replace(/[:.]/g, '-')}-${task.id}.mp4`);
  const cleanup = async (task: ExportTask, removeOutput: boolean) => {
    inputs.verify();
    await rm(workPath(task), { recursive: true, force: true });
    if (removeOutput) await rm(outputPath(task), { force: true });
  };
  // 由独立服务所有权保证此处没有前一服务仍在运行；不自动重试中断任务。
  const interrupted = tasks().filter(task => !['succeeded', 'failed', 'cancelled'].includes(task.state));
  if (interrupted.length) {
    active = interrupted[0];
    running = (async () => {
      for (const task of interrupted) {
        task.state = 'cleaning'; task.message = '正在清理中断导出'; save(task);
        await cleanup(task, true);
        await rm(previewPath(task), { force: true });
        task.state = 'failed'; task.message = '导出已中断，请重新导出'; save(task);
      }
      active = undefined;
    })().catch(error => { if (active) { active.message = `清理失败，项目仍锁定：${(error as Error).message}`; } });
  }
  const api = {
    assertUnlocked,
    getExportTasks(): ExportTasksStatus {
      const all = tasks();
      return { locked: !!active, tasks: all.map(task => task.id === active?.id ? structuredClone(active) : task) };
    },
    submitExport(): ExportTask {
      if (closed) throw new Error('服务正在退出');
      if (active) return structuredClone(active);
      const snapshot = inputs.snapshot();
      const speech = inputs.speech();
      const task: ExportTask = { id: randomUUID(), createdAt: new Date().toISOString(), state: 'accepted', message: '已受理，尚未完成', completed: 0, total: snapshot.segments.length,
        issues: inputs.busy().map(message => ({ field: 'project', message })), warnings: [] };
      save(task); active = task;
      controller = new AbortController(); const signal = controller.signal;
      running = (async () => {
        await new Promise<void>(resolve => setImmediate(resolve));
        let succeeded = false;
        let published = false;
        let previewPublished = false;
        try {
          signal.throwIfAborted();
          task.state = 'validating'; task.message = '正在汇总导出问题'; save(task);
          if (!snapshot.segments.length) task.issues.push({ field: 'project', message: '空项目不能导出' });
          inputs.verify(); mkdirSync(directory, { recursive: true }); inputs.verify();
          const workspace = workPath(task); await mkdir(workspace);
          const render: RenderSegment[] = [];
          const videos = new Map<string, { path: string; duration: number }>();
          for (const [index, segment] of snapshot.segments.entries()) {
            signal.throwIfAborted();
            const location = { segmentId: segment.id, order: segment.order };
            let video: { path: string; duration: number } | undefined;
            if (!segment.video) task.issues.push({ ...location, field: 'video', message: '视频缺失' });
            else {
              try {
                video = videos.get(segment.video.assetId);
                if (!video) {
                  const source = inputs.video(segment.video.assetId);
                  const path = join(workspace, `video-${index}.source`);
                  await copyFile(source, path, constants.COPYFILE_EXCL);
                  signal.throwIfAborted();
                  video = { path, duration: await validateVideo(path, signal) };
                  videos.set(segment.video.assetId, video);
                }
              } catch (error) { task.issues.push({ ...location, field: 'video', message: `视频不可读或不可解码：${(error as Error).message}` }); }
              if (!Number.isFinite(segment.video.start) || segment.video.start < 0 || segment.video.start >= (video?.duration ?? snapshot.assets.find(asset => asset.id === segment.video!.assetId)?.duration ?? Infinity)) {
                task.issues.push({ ...location, field: 'start', message: '视频起点必须大于等于零且严格小于视频时长' });
              }
            }
            const recordings = speech.audio.filter(audio => audio.segmentId === segment.id);
            const current = recordings.filter(audio => audio.valid).at(-1);
            if (!current) task.issues.push({ ...location, field: 'speech', message: recordings.length ? '配音待更新' : '配音缺失' });
            else {
              try {
                const source = inputs.audio(current.taskId);
                const copied = join(workspace, `speech-${index}.mp3`);
                await copyFile(source, copied, constants.COPYFILE_EXCL);
                const audio = await prepareExportAudio(copied, workspace, index, signal);
                if (video && segment.video) {
                  render.push({ segment, video: video.path, ...audio });
                  if (video.duration - segment.video.start < audio.duration) task.warnings.push({ ...location, field: 'video', message: '视频剩余时长不足，末帧将冻结补足配音时长' });
                }
              } catch (error) { task.issues.push({ ...location, field: 'speech', message: `配音不可读或不可解码：${(error as Error).message}` }); }
            }
          }
          signal.throwIfAborted();
          const settings = await inputs.settings(signal);
          task.issues.push(...settings.issues.map(message => ({ field: 'settings' as const, message })));
          signal.throwIfAborted();
          if (task.issues.length) throw new Error('导出校验失败，请修正全部问题后重试');
          task.state = 'rendering';
          for (const [index, input] of render.entries()) {
            signal.throwIfAborted();
            task.segmentId = input.segment.id; task.message = `正在渲染片段 ${input.segment.order}（${index + 1}/${render.length}）`; save(task);
            await renderExportSegment(input, snapshot.exportSettings, workspace, index, signal);
            task.completed++; save(task);
          }
          delete task.segmentId; task.message = '正在拼接并验证成片'; save(task);
          const result = await assembleExport(render, snapshot.exportSettings, workspace, signal);
          task.message = '正在生成播放预览'; save(task);
          const preview = await renderExportPreview(workspace, signal);
          signal.throwIfAborted(); inputs.verify();
          await link(preview, previewPath(task)); previewPublished = true;
          await link(result, outputPath(task));
          published = true;
          signal.throwIfAborted();
          succeeded = true;
        } catch (error) {
          task.message = signal.aborted ? '导出已取消' : (error as Error).message;
          if (task.segmentId) task.issues.push({ segmentId: task.segmentId, order: snapshot.segments.find(segment => segment.id === task.segmentId)?.order, field: 'video', message: task.message });
        }
        const resultMessage = task.message;
        task.state = 'cleaning'; task.message = '正在停止任务并清理本次临时文件'; save(task);
        await cleanup(task, published && (!succeeded || signal.aborted));
        // 取消也可能发生在异步清理期间，发布文件须再次核对。
        if (published && signal.aborted) { inputs.verify(); await rm(outputPath(task), { force: true }); }
        if (previewPublished && (!succeeded || signal.aborted)) { inputs.verify(); await rm(previewPath(task), { force: true }); }
        if (signal.aborted) { task.state = 'cancelled'; task.message = '导出已取消，本次文件已清理'; }
        else if (succeeded) {
          task.state = 'succeeded'; task.message = '导出成功';
          task.output = { path: outputPath(task), url: `/api/exports/${task.id}/file`, previewUrl: `/api/exports/${task.id}/preview` };
        } else { task.state = 'failed'; task.message = resultMessage; }
        save(task); active = undefined; controller = undefined;
      })().catch(error => {
        // 清理或终态持久化失败时保留锁，不把仍存在的半成品说成已清理。
        task.state = 'cleaning'; task.message = `清理或保存失败，项目仍锁定：${(error as Error).message}`;
      });
      return structuredClone(task);
    },
    getExportFile(id: string, kind: 'file' | 'preview' = 'file') {
      const task = tasks().find(task => task.id === id && task.state === 'succeeded');
      if (!task) throw new Error('成片不存在或导出未成功');
      inputs.verify(); const path = kind === 'preview' ? previewPath(task) : outputPath(task); verifyMedia(path); return path;
    },
    cancelExport(id: string): ExportTask {
      const task = active?.id === id ? active : tasks().find(task => task.id === id);
      if (!task) throw new Error('导出任务不存在');
      if (active?.id === id) { task.state = 'cleaning'; task.message = '正在停止任务并清理本次文件'; save(task); controller?.abort(); }
      return structuredClone(task);
    },
    async close() { closed = true; controller?.abort(); await running; },
  };
  return api;
}
