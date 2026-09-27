import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { openBusiness } from '../business/index.js';
import type { ServiceStatus } from '../shared/contracts.js';

export interface ServiceOptions {
  projectDirectory: string;
  panelDirectory: string;
  port: number;
  dev?: boolean;
}

export async function startService(options: ServiceOptions) {
  const business = openBusiness(options.projectDirectory);
  const instanceId = randomUUID();
  const startedAt = new Date().toISOString();
  let vite: import('vite').ViteDevServer | undefined;
  try {
    const files = new Map<string, Buffer>();
    if (options.dev) {
      const { createServer: createViteServer } = await import('vite');
      vite = await createViteServer({ server: { middlewareMode: true, hmr: false }, appType: 'spa' });
    } else {
      // 显式白名单只包含构建产物，项目数据库与媒体永不经静态路由暴露。
      for (const file of readdirSync(options.panelDirectory, { recursive: true, withFileTypes: true })) {
        if (file.isFile()) {
          const absolute = join(file.parentPath, file.name);
          const relative = absolute.slice(options.panelDirectory.length).replaceAll('\\', '/');
          files.set(relative, readFileSync(absolute));
        }
      }
      if (!files.has('/index.html')) throw new Error('面板构建缺失，请先运行 npm run build。');
    }
    const server = createServer((request, response) => {
      const host = `127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Cache-Control', 'no-store');
      const reject = (status: number, message: string) => {
        response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: message }));
      };
      if (request.headers.host !== host || (request.headers.origin && request.headers.origin !== `http://${host}`)) {
        reject(403, '仅允许本机同源访问。'); return;
      }
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET'); reject(405, '骨架仅提供只读查询。'); return;
      }
      let path: string;
      try {
        path = new URL(request.url ?? '/', `http://${host}`).pathname;
      } catch {
        reject(400, '请求路径无效。'); return;
      }
      if (path === '/api/status') {
        try {
          const status: ServiceStatus = {
            application: 'clapgrid', apiVersion: 1, instanceId, pid: process.pid,
            startedAt, snapshot: business.getSnapshot(),
          };
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify(status));
        } catch {
          reject(500, '读取项目状态失败。');
        }
      } else if (path.startsWith('/api/')) {
        reject(404, '接口不存在。');
      } else if (vite) {
        vite.middlewares(request, response);
      } else {
        const file = files.get(path === '/' ? '/index.html' : path);
        if (!file) { reject(404, '文件不存在。'); return; }
        const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
        response.writeHead(200, { 'Content-Type': `${types[extname(path === '/' ? 'index.html' : path)] ?? 'application/octet-stream'}; charset=utf-8` });
        response.end(file);
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port, '127.0.0.1', () => {
        server.off('error', reject); resolve();
      });
    });
    const port = (server.address() as import('node:net').AddressInfo).port;
    return {
      url: `http://127.0.0.1:${port}`,
      async close() {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        await vite?.close();
        business.close();
      },
    };
  } catch (error) {
    await vite?.close();
    business.close();
    throw error;
  }
}
