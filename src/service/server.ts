import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { openBusiness } from '../business/index.js';
import { addSegmentSchema, editSegmentSchema, type ServiceStatus } from '../shared/contracts.js';

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
    const status = (): ServiceStatus => ({
      application: 'clapgrid', apiVersion: 1, instanceId, pid: process.pid,
      startedAt, snapshot: business.getSnapshot(),
    });
    const server = createServer(async (request, response) => {
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
      let path: string;
      try {
        path = new URL(request.url ?? '/', `http://${host}`).pathname;
      } catch {
        reject(400, '请求路径无效。'); return;
      }
      if (path === '/api/segments/add' || path === '/api/segments/edit') {
        if (request.method !== 'POST') {
          response.setHeader('Allow', 'POST'); reject(405, '请使用 POST 提交编辑。'); return;
        }
        if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
          reject(415, '编辑请求必须使用 application/json。'); return;
        }
        let input: unknown;
        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 8 * 1024 * 1024) { reject(413, '请求内容过大。'); return; }
            chunks.push(Buffer.from(chunk));
          }
          input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch { reject(400, '编辑请求格式无效。'); return; }
        const parsed = (path.endsWith('/add') ? addSegmentSchema : editSegmentSchema).safeParse(input);
        if (!parsed.success) { reject(400, '请提供有效的片段身份和文案，不允许修改其他状态。'); return; }
        try {
          const data = parsed.data;
          const snapshot = 'id' in data ? business.editSegment(editSegmentSchema.parse(data).id, data.text) : business.addSegment(data.text);
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ ...status(), snapshot }));
        } catch {
          reject(500, '保存失败，未确认本次编辑已保存；请检查项目目录或数据库占用后重试。');
        }
        return;
      }
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET'); reject(405, '此接口仅提供查询。'); return;
      }
      if (path === '/api/status') {
        try {
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify(status()));
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
