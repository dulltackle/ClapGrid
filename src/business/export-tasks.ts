import { segmentMaterials, segmentVideos } from '../shared/contracts.js';
import type { ProjectAccess } from './project-access.js';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ExportTask, ExportTasksStatus, ExportStatus, Snapshot, SpeechStatus } from '../shared/contracts.js';
import { validateImage, validateVideo } from './video-media.js';
import { exportFiles } from './export-files.js';
import { assembleExport, prepareExportAudio, renderExportSegment, renderExportPreview, type RenderSegment } from './export-render.js';

type ExportInputs = {
  snapshot: () => Snapshot;
  settings: (signal?: AbortSignal) => Promise<ExportStatus>;
  access: ProjectAccess;
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
  const project = inputs.snapshot();
  const files = exportFiles({ directory: project.project.directory, mediaDirectory: project.storage.mediaDirectory }, inputs.verify);
  let active: ExportTask | undefined;
  let running: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let closed = false;
  // 由独立服务所有权保证此处没有前一服务仍在运行；不自动重试中断任务。
  const interrupted = tasks().filter(task => !['succeeded', 'failed', 'cancelled', 'interrupted'].includes(task.state));
  if (interrupted.length) {
    const release = inputs.access.beginTask('export');
    active = interrupted[0];
    running = (async () => {
      for (const task of interrupted) {
        task.state = 'cleaning'; task.message = '正在清理中断导出'; save(task);
        await files.recover(task);
        task.state = 'interrupted'; task.message = '导出已中断，本次文件已清理；不会自动重试，请重新导出'; save(task);
      }
      active = undefined; release();
    })().catch(error => { if (active) { active.message = `清理失败，项目仍锁定：${(error as Error).message}`; } });
  }
  function previewInput(segmentId: string) {
    const snapshot = inputs.snapshot(); const segment = snapshot.segments.find(segment => segment.id === segmentId);
    const speech = inputs.speech();
    return JSON.stringify([segment, snapshot.exportSettings, speech.voice, speech.audio.filter(audio => audio.segmentId === segmentId && audio.valid).at(-1)?.taskId]);
  }
  const api = {
    getExportTasks(): ExportTasksStatus {
      const all = tasks();
      return { locked: inputs.access.getActivity().task === 'export', tasks: all.filter(task => !task.preview).map(task => task.id === active?.id ? structuredClone(active) : task) };
    },
    getVisualPreviews() {
      return { ...api.getExportTasks(), tasks: tasks().filter(task => task.preview).map(task => task.id === active?.id ? structuredClone(active) : task).map(task => ({ ...task, current: task.state === 'succeeded' && task.preview!.input === previewInput(task.preview!.segmentId) })) };
    },
    submitPreview(segmentId: string) { return api.submitExport(segmentId); },
    submitExport(previewSegmentId?: string): ExportTask {
      if (closed) throw new Error('服务正在退出');
      if (active) { if (active.preview?.segmentId !== previewSegmentId) throw new Error('已有制作任务进行中'); return structuredClone(active); }
      inputs.access.assertAllowed('export');
      const snapshot = inputs.snapshot();
      if (previewSegmentId) {
        if (!snapshot.segments.some(segment => segment.id === previewSegmentId)) throw new Error('口播片段不存在');
        snapshot.segments = snapshot.segments.filter(segment => segment.id === previewSegmentId);
      }
      const speech = inputs.speech();
      const task: ExportTask = { id: randomUUID(), createdAt: new Date().toISOString(), state: 'accepted', message: '已受理，尚未完成', completed: 0, total: snapshot.segments.length,
        issues: [], warnings: [], ...(previewSegmentId ? { preview: { segmentId: previewSegmentId, input: previewInput(previewSegmentId) } } : {}) };
      const release = inputs.access.beginTask('export');
      try { save(task); } catch (error) { release(); throw error; }
      active = task;
      controller = new AbortController(); const signal = controller.signal;
      running = (async () => {
        await new Promise<void>(resolve => setImmediate(resolve));
        const outputFiles = files.open(task, signal);
        try {
          signal.throwIfAborted();
          task.state = 'validating'; task.message = '正在汇总导出问题'; save(task);
          if (!snapshot.segments.length) task.issues.push({ field: 'project', message: '空项目不能导出' });
          const workspace = await outputFiles.prepare();
          const render: RenderSegment[] = [];
          const videos = new Map<string, { path: string; duration: number; kind?: 'image' | 'video' }>();
          let copyIndex = 0;
          for (const [index, segment] of snapshot.segments.entries()) {
            signal.throwIfAborted();
            const location = { segmentId: segment.id, order: segment.order };
            const native = segment.materials !== undefined;
            const plan = segment.composition;
            if (native && (!plan || plan.inputVersion !== segment.visualVersion)) task.issues.push({ ...location, field: 'video', message: '画面编排缺失或待更新，请由 agent 根据本句最新内容编排' });
            if (!native && segmentVideos(segment).length > 1) task.issues.push({ ...location, field: 'video', message: '旧多视频素材尚未编排，不能自动均分' });
            if (previewSegmentId && !plan) task.issues.push({ ...location, field: 'video', message: '片段合成预览需要已保存的画面编排' });
            const references = native ? segmentMaterials(segment).map(assetId => ({ assetId, start: 0 })) : segmentVideos(segment);
            const visualInputs: { path: string; duration: number; start: number; assetId: string; kind?: 'image' | 'video' }[] = [];
            if (!references.length) task.issues.push({ ...location, field: 'video', message: '视频缺失' });
            for (const [visualIndex, reference] of references.entries()) {
              let video: { path: string; duration: number; kind?: 'image' | 'video' } | undefined;
              try {
                video = videos.get(reference.assetId);
                if (!video) {
                  const source = inputs.video(reference.assetId);
                  const path = await outputFiles.copy('video', copyIndex++, source);
                  const asset = snapshot.assets.find(asset => asset.id === reference.assetId);
                  if (!asset) throw new Error('素材记录缺失');
                  if (asset.kind === 'image') await validateImage(path, signal);
                  video = { path, duration: asset.kind === 'image' ? Infinity : await validateVideo(path, signal), kind: asset.kind };
                  videos.set(reference.assetId, video);
                }
                visualInputs.push({ ...video, start: reference.start, assetId: reference.assetId });
                if (plan?.layers.some(layer => layer.assetId === reference.assetId && layer.start >= video!.duration)) task.issues.push({ ...location, field: 'start', message: '编排的视频起点超出真实时长' });
              } catch (error) { task.issues.push({ ...location, field: 'video', message: `素材 ${visualIndex + 1} 不可读或不可解码：${(error as Error).message}` }); }
              if (!Number.isFinite(reference.start) || reference.start < 0 || reference.start >= (video?.duration ?? snapshot.assets.find(asset => asset.id === reference.assetId)?.duration ?? Infinity)) {
                task.issues.push({ ...location, field: 'start', message: '视频起点必须大于等于零且严格小于视频时长' });
              }
            }
            const recordings = speech.audio.filter(audio => audio.segmentId === segment.id);
            const current = recordings.filter(audio => audio.valid).at(-1);
            if (!current) task.issues.push({ ...location, field: 'speech', message: recordings.length ? '配音待更新' : '配音缺失' });
            else {
              try {
                const source = inputs.audio(current.taskId);
                const copied = await outputFiles.copy('speech', index, source);
                const audio = await prepareExportAudio(copied, workspace, index, signal);
                if (visualInputs.length === references.length && visualInputs.length) {
                  if (plan && Math.abs(plan.duration - audio.duration) > 0.001) task.issues.push({ ...location, field: 'video', message: `编排时长 ${plan.duration} 秒与配音 ${audio.duration} 秒不一致，请更新编排` });
                  render.push({ segment, videos: visualInputs, plan, ...audio });
                  if (visualInputs.some(video => video.duration - video.start < (plan ? Math.max(0, ...plan.layers.filter(layer => layer.assetId === video.assetId).map(layer => layer.to - layer.from + layer.start)) : audio.duration))) task.warnings.push({ ...location, field: 'video', message: '视频剩余时长不足，末帧将冻结补足配音时长' });
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
          await outputFiles.publish(result, preview);
        } catch (error) {
          task.message = signal.aborted ? '导出已取消' : (error as Error).message;
          if (task.segmentId) task.issues.push({ segmentId: task.segmentId, order: snapshot.segments.find(segment => segment.id === task.segmentId)?.order, field: 'video', message: task.message });
        }
        const resultMessage = task.message;
        task.state = 'cleaning'; task.message = '正在停止任务并清理本次临时文件'; save(task);
        await outputFiles.finish(output => {
          if (signal.aborted) { task.state = closed ? 'interrupted' : 'cancelled'; task.message = closed ? '导出已中断，本次文件已清理；不会自动重试' : '导出已取消，本次文件已清理'; }
          else if (output) {
            task.state = 'succeeded'; task.message = '导出成功';
            task.output = output;
          } else { task.state = 'failed'; task.message = resultMessage; }
          save(task); active = undefined; controller = undefined; release();
        });
      })().catch(error => {
        // 清理或终态持久化失败时保留锁，不把仍存在的半成品说成已清理。
        task.state = 'cleaning'; task.message = `清理或保存失败，项目仍锁定：${(error as Error).message}`;
      });
      return structuredClone(task);
    },
    getExportFile(id: string, kind: 'file' | 'preview' = 'file') {
      const task = tasks().find(task => task.id === id && task.state === 'succeeded');
      if (!task) throw new Error('成片不存在或导出未成功');
      return files.read(task, kind);
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
