import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { workspaceProject } from './workspace-service.js';
import { readHostWorkspace } from './host-workspace.js';
import { claimProjectService } from './business/service-ownership.js';

/** 只接受已退出服务的源项目；服务所有权覆盖检查和复制的整个期间。 */
export async function importProject(args: string[]) {
  const { values } = parseArgs({ args, options: { workspace: { type: 'string' }, thread: { type: 'string' }, source: { type: 'string' }, 'confirm-idle': { type: 'boolean' } } });
  if (!values.source || !values['confirm-idle']) throw new Error('迁入必须明确指定 --source，并通过 --confirm-idle 确认无运行任务。');
  if (!values.workspace || !values.thread) throw new Error('请先选择或创建本地工作空间，并提供聊天身份。');
  const { workspace, project } = workspaceProject(values.workspace);
  if (await readHostWorkspace(values.thread) !== workspace) throw new Error('宿主工作空间已改变，请重新核对后迁入。');
  if (!isAbsolute(values.source)) throw new Error('来源必须是明确指定的绝对路径。');
  const source = realpathSync(values.source);
  if (project === source || project.startsWith(source + sep) || source.startsWith(project + sep)) throw new Error('来源与目标不能相同或互相包含。');
  if (!existsSync(join(source, 'clapgrid.sqlite'))) throw new Error('来源不是已有 ClapGrid 项目。');
  const reservation = join(dirname(project), `.${basename(project)}-import`);
  try { mkdirSync(reservation); } catch { throw new Error('目标正在迁入或上次迁入中断；请检查迁入现场，不会覆盖或自动重试。'); }
  let staging: string | undefined;
  let mediaLock: DatabaseSync | undefined;
  let release: (() => void) | undefined;
  try {
    if (existsSync(project)) throw new Error('目标已有项目或目录，拒绝覆盖或合并。');
    try { release = claimProjectService(source); } catch { throw new Error('源项目服务仍在运行，无法保证复制一致性；请确认任务结束并退出源服务后迁入。'); }
    if (existsSync(join(source, 'media-active.json'))) throw new Error('源项目媒体进程状态尚未确认，请在源项目完成恢复后迁入。');
    mediaLock = new DatabaseSync(join(source, 'media-owner.sqlite'));
    try { mediaLock.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE'); }
    catch { throw new Error('源项目媒体进程仍在运行，拒绝迁入。'); }
    // 不复制链接和特殊文件，避免迁入产物仍依赖源目录或复制越界。
    const verifyTree = (directory: string) => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name); const stat = lstatSync(path);
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || (stat.isFile() && stat.nlink !== 1)) throw new Error('源项目包含链接或特殊文件，无法安全复制。');
        if (stat.isDirectory()) verifyTree(path);
      }
    };
    verifyTree(source);
    const db = new DatabaseSync(join(source, 'clapgrid.sqlite'), { readOnly: true });
    try {
      if (!db.prepare('SELECT id FROM project_identity WHERE singleton = 1').get()) throw new Error('来源项目身份缺失。');
      for (const [table, terminal] of [['speech_tasks', ['succeeded', 'failed', 'unknown']], ['export_tasks', ['succeeded', 'failed', 'cancelled', 'interrupted']]] as const) {
        if (!db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', table)) continue;
        for (const row of db.prepare(`SELECT value FROM ${table}`).all()) {
          if (!(terminal as readonly string[]).includes(JSON.parse(String(row.value)).state)) throw new Error('源项目存在运行任务或待清理任务，拒绝迁入；请先在源服务完成恢复。');
        }
      }
    } finally { db.close(); }
    staging = mkdtempSync(join(reservation, 'project-'));
    cpSync(source, staging, { recursive: true, errorOnExist: true, force: false,
      filter: path => !['service.json', 'service.log', 'service-owner.sqlite', 'service-owner.sqlite-journal', 'service-owner.sqlite-wal', 'service-owner.sqlite-shm', 'media-owner.sqlite', 'media-active.json'].includes(basename(path)) });
    const copied = new DatabaseSync(join(staging, 'clapgrid.sqlite'));
    try {
      copied.exec('BEGIN IMMEDIATE');
      copied.prepare('UPDATE project_identity SET id = ? WHERE singleton = 1').run(randomUUID());
      if (copied.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'export_tasks'").get()) {
        for (const row of copied.prepare('SELECT id, value FROM export_tasks').all()) {
          const task = JSON.parse(String(row.value));
          if (task.output?.path) {
            const path = relative(source, task.output.path);
            if (!isAbsolute(task.output.path) || path.startsWith(`..${sep}`) || path === '..' || isAbsolute(path) || !existsSync(join(staging, path))) throw new Error('已有成片不在源项目内或文件缺失，无法完整迁入。');
            task.output.path = join(project, path);
            copied.prepare('UPDATE export_tasks SET value = ? WHERE id = ?').run(JSON.stringify(task), row.id!);
          }
        }
      }
      copied.exec('COMMIT');
    } finally { copied.close(); }
    if (await readHostWorkspace(values.thread) !== workspace) throw new Error('宿主工作空间已改变，迁入未发布。');
    if (existsSync(project)) throw new Error('目标已有项目或目录，拒绝覆盖或合并。');
    renameSync(staging, project); staging = undefined;
    return { projectDirectory: project, source, message: '迁入完成，原件保留；请从日常打开入口核对新项目。' };
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
    mediaLock?.close();
    release?.();
    rmSync(reservation, { recursive: true, force: true });
  }
}
