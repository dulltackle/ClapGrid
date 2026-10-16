import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

/** 等待 Chrome 写完调试端口文件；文件出现不代表内容已就绪。 */
export async function waitForDevToolsPort(path: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const port = readFileSync(path, 'utf8').split('\n')[0];
      if (port) return port;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    // 文件缺失和内容未写完都退让，不能在空文件上快速耗尽重试次数。
    await delay(Math.max(0, Math.min(50, deadline - Date.now())));
  } while (Date.now() < deadline);
  throw Error('Chrome 必须启动，不能将环境缺失记为通过');
}
