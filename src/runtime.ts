import { spawn } from 'node:child_process';
import { realpathSync, existsSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { projectPaths } from './business/project-paths.js';
import { serviceOptions } from './service/options.js';
import { queryStatus } from './shared/client.js';

try {
  const action = process.argv[2];
  if (action !== 'start' && action !== 'status') throw new Error('用法：runtime start|status --project <目录> [--port <端口>]');
  const options = serviceOptions(process.argv.slice(3));
  if (options.dev) throw new Error('后台入口仅使用构建产物；开发模式使用 npm run dev。');
  const url = `http://127.0.0.1:${options.port}`;
  const verify = async () => {
    const status = await queryStatus(url);
    if (status.snapshot.project.directory !== (existsSync(options.projectDirectory) ? realpathSync(options.projectDirectory) : options.projectDirectory)) {
      throw new Error('端口上的服务属于其他项目，请保留该服务并明确选择其他端口。');
    }
    return { ...status, url };
  };
  if (action === 'status') {
    console.log(JSON.stringify(await verify(), null, 2));
  } else {
    // 只在明确拒绝连接时启动；未知服务、超时或身份不符均保留现场。
    let offline = false;
    try {
      await queryStatus(url);
    } catch (error) {
      if (error instanceof TypeError && (error.cause as NodeJS.ErrnoException)?.code === 'ECONNREFUSED') offline = true;
      else throw error;
    }
    if (!offline) {
      console.log(JSON.stringify(await verify(), null, 2));
    } else {
      const { projectDirectory } = projectPaths(options.projectDirectory);
      const log = openSync(join(projectDirectory, 'service.log'), 'a', 0o600);
      const child = spawn(process.execPath, [
        fileURLToPath(new URL('./service/main.js', import.meta.url)),
        '--project', options.projectDirectory, '--port', String(options.port),
      ], { detached: true, stdio: ['ignore', log, log], windowsHide: true });
      closeSync(log);
      let childError: Error | undefined;
      child.on('error', error => { childError = error; });
      child.unref();
      let ready = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        await setTimeout(100);
        if (childError) throw childError;
        if (child.exitCode !== null) throw new Error('服务启动失败，请检查项目目录内的 service.log。');
        try {
          const status = await verify();
          console.log(JSON.stringify(status, null, 2));
          ready = true; break;
        } catch { /* 等待子进程完成监听；不重新发起启动。 */ }
      }
      if (!ready) throw new Error('启动未确认，请查看 service.log 并独立查询 status；本次不自动重启。');
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
