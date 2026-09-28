import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { projectPaths } from './project-paths.js';
import { mediaProcess } from './media-process.js';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

const { projectDirectory } = projectPaths(process.argv[2]!);
const lock = new DatabaseSync(join(projectDirectory, 'media-owner.sqlite'));
const tasks = new Map<string, { controller: AbortController; done: Promise<void> }>();
const marker = join(projectDirectory, 'media-active.json');
const bootId = process.platform === 'linux' ? readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() : null;
let stopping = false;
process.on('disconnect', () => {
  stopping = true;
  for (const task of tasks.values()) task.controller.abort();
  void Promise.all([...tasks.values()].map(task => task.done)).then(() => { lock.close(); process.exit(); });
});
// 新服务先取得媒体锁，再打开业务数据库执行恢复。
while (process.connected) {
  try { lock.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE'); break; }
  catch (error) {
    if ((error as { errcode?: number }).errcode !== 5) throw error;
    await setTimeout(50);
  }
}
if (process.connected && !stopping) {
  if (existsSync(marker)) {
    const previous = JSON.parse(readFileSync(marker, 'utf8'));
    // 同一次开机遗留标记意味着守护进程自身异常，不能仅凭锁释放就删除输出。
    if (!bootId || !previous.bootId || previous.bootId === bootId) throw new Error('旧媒体守护进程异常退出，尚未确认子进程终止；保留项目锁和文件，请人工核对媒体运行记录');
    rmSync(marker);
  }
  process.on('message', (message: any) => {
    if (stopping) return;
    if (message.abort) { tasks.get(message.abort)?.controller.abort(); return; }
    const controller = new AbortController();
    writeFileSync(marker, JSON.stringify({ bootId, guardianPid: process.pid, startedAt: new Date().toISOString() }), { mode: 0o600 });
    const done = mediaProcess(message.command, message.args, { ...message.options, signal: controller.signal })
      .then(result => { if (process.connected) process.send!({ id: message.id, result }); },
        error => { if (process.connected) process.send!({ id: message.id, error: (error as Error).message }); })
      .finally(() => { tasks.delete(message.id); if (!tasks.size) rmSync(marker, { force: true }); });
    tasks.set(message.id, { controller, done });
  });
  process.send!({ ready: true });
}
