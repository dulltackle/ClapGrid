import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import type { ExportTask } from '../shared/contracts.js';
import { verifyMedia } from './video-media.js';

type Identity = Pick<ExportTask, 'id' | 'createdAt'>;

/** 管理一次导出的文件归属；任务确认终态落盘后，才可开放成片读取。 */
export function exportFiles(project: { directory: string; mediaDirectory: string }, verify: () => void) {
  const directory = join(project.directory, 'exports');
  const paths = (task: Identity) => ({
    workspace: join(directory, `.work-${task.id}`),
    file: join(directory, `${task.createdAt.replace(/[:.]/g, '-')}-${task.id}.mp4`),
    preview: join(project.mediaDirectory, `${task.id}.export.webm`),
  });
  const removeWork = async (path: string) => {
    verify(); await fs.rm(path, { recursive: true, force: true });
  };
  const removePublished = async (files: Iterable<string>) => {
    for (const path of files) { verify(); await fs.rm(path, { force: true }); }
  };
  return {
    open(task: Identity, signal: AbortSignal) {
      const target = paths(task);
      const owned = new Set<string>();
      let published = false;
      return {
        async prepare() {
          signal.throwIfAborted(); verify();
          await fs.mkdir(directory, { recursive: true });
          signal.throwIfAborted(); verify();
          await fs.mkdir(target.workspace);
          return target.workspace;
        },
        async copy(kind: 'video' | 'speech', index: number, source: string) {
          signal.throwIfAborted(); verify();
          const path = join(target.workspace, `${kind}-${index}.${kind === 'video' ? 'source' : 'mp3'}`);
          await fs.copyFile(source, path, constants.COPYFILE_EXCL);
          signal.throwIfAborted();
          return path;
        },
        async publish(result: string, preview: string) {
          // 链接成功才取得文件归属；目标冲突时不能覆盖或清理原有文件。
          signal.throwIfAborted(); verify();
          await fs.link(preview, target.preview); owned.add(target.preview);
          signal.throwIfAborted(); verify();
          await fs.link(result, target.file); owned.add(target.file);
          signal.throwIfAborted();
          published = true;
        },
        async finish(commit: (output: ExportTask['output']) => void) {
          // 媒体处理已经停止；清理期间仍可取消，必须在删除工作目录后判断。
          await removeWork(target.workspace);
          // 保留文件与同步提交终态之间不再让出执行权，避免引入新的取消窗口。
          if (published && !signal.aborted) {
            commit({ path: target.file, url: `/api/exports/${task.id}/file`, previewUrl: `/api/exports/${task.id}/preview` });
            return;
          }
          await removePublished(owned);
          commit(undefined);
        },
      };
    },
    async recover(task: Identity) {
      // 独立服务已确认旧媒体进程停止；未落盘为成功的产物全部撤销，不续导。
      const target = paths(task);
      await removeWork(target.workspace);
      await removePublished([target.file, target.preview]);
    },
    read(task: Identity, kind: 'file' | 'preview') {
      verify(); const path = paths(task)[kind]; verifyMedia(path); return path;
    },
  };
}
