import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { claimProjectService } from '../business/service-ownership.js';
import { openBusiness } from '../business/index.js';
import { addSegmentSchema, editSegmentSchema, batchSchema, type ServiceStatus } from '../shared/contracts.js';

export interface ServiceOptions {
  projectDirectory: string;
  panelDirectory: string;
  port: number;
  dev?: boolean;
}

export async function startService(options: ServiceOptions) {
  const releaseOwnership = claimProjectService(options.projectDirectory);
  let business: ReturnType<typeof openBusiness>;
  try { business = openBusiness(options.projectDirectory); }
  catch (error) { releaseOwnership(); throw error; }
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
      startedAt, snapshot: business.getSnapshot(), modification: business.getModification(),
    });
    const sessions = new Map<string, () => void>();
    const finishSession = (token: string) => {
      business.release(token);
      sessions.get(token)?.();
      sessions.delete(token);
    };
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
      const json = (body: unknown) => {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(body));
      };
      if (path === '/api/edit-session') {
        if (request.method !== 'POST') { reject(405, '请使用 POST 申请修改权。'); return; }
        let token: string;
        try { token = business.acquire('user'); }
        catch (error) { reject(409, (error as Error).message); return; }
        try {
          const initial = { token, status: status() };
          response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
          response.write(JSON.stringify(initial) + '\n');
          // 长连接属于一次编辑；心跳让失联连接可被发现，关闭时只释放该 token。
          const heartbeat = setInterval(() => { response.write('\n'); }, 1000);
          const cleanup = () => { clearInterval(heartbeat); response.end(); };
          sessions.set(token, cleanup);
          response.on('close', () => finishSession(token));
        } catch { finishSession(token); reject(500, '读取项目失败，修改权已释放。'); }
        return;
      }
      if (path === '/api/edit-session/release') {
        if (request.method !== 'POST') { reject(405, '请使用 POST 释放修改权。'); return; }
        const token = request.headers['x-edit-token'];
        if (typeof token !== 'string') { reject(400, '缺少修改权凭据。'); return; }
        finishSession(token); json({ released: true }); return;
      }
      if (path === '/api/segments/add' || path === '/api/segments/edit' || path === '/api/codex/modify') {
        if (request.method !== 'POST') {
          response.setHeader('Allow', 'POST'); reject(405, '请使用 POST 提交编辑。'); return;
        }
        if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
          reject(415, '编辑请求必须使用 application/json。'); return;
        }
        const codex = path === '/api/codex/modify';
        let token: string;
        try {
          if (codex) token = business.acquire('codex');
          else {
            const supplied = request.headers['x-edit-token'];
            if (typeof supplied !== 'string' || !business.owns(supplied, 'user')) {
              reject(409, business.getModification()?.owner === 'codex' ? 'Codex 正在修改' : '请先取得用户修改权，修改权可能已失效。'); return;
            }
            token = supplied;
          }
        } catch (error) { reject(409, (error as Error).message); return; }
        const release = () => codex ? business.release(token) : finishSession(token);
        response.on('close', release);
        // 请求体断开或一直未完成都不能永久占用普通修改权。
        const timeout = setTimeout(() => { release(); request.destroy(); }, 10000);
        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 8 * 1024 * 1024) { reject(413, '请求内容过大。'); return; }
            chunks.push(Buffer.from(chunk));
          }
          clearTimeout(timeout);
          let input: unknown;
          try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { reject(400, '编辑请求格式无效。'); return; }
          if (!business.owns(token, codex ? 'codex' : 'user')) {
            reject(409, '修改权已失效，请重新读取项目后编辑。'); return;
          }
          if (codex) {
            const parsed = batchSchema.safeParse(input);
            if (!parsed.success) { reject(400, '批量修改格式无效；修改和删除必须提供查询时的目标快照。'); return; }
            const result = await business.modifyBatch(token, parsed.data);
            release(); json({ ...result, status: status() });
          } else {
            const parsed = (path.endsWith('/add') ? addSegmentSchema : editSegmentSchema).safeParse(input);
            if (!parsed.success) { reject(400, '请提供有效的片段身份和文案，不允许修改其他状态。'); return; }
            const data = parsed.data;
            if ('id' in data) business.editSegment(editSegmentSchema.parse(data).id, data.text, token);
            else business.addSegment(data.text, token);
            release(); json(status());
          }
        } catch {
          if (!response.destroyed) reject(500, '保存失败，未确认本次编辑已保存；请检查项目目录或数据库占用后重试。');
        } finally { clearTimeout(timeout); release(); }
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
    let closing: Promise<void> | undefined;
    return {
      url: `http://127.0.0.1:${port}`,
      close() {
        return closing ??= (async () => {
          for (const token of sessions.keys()) finishSession(token);
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
          await vite?.close();
          business.close();
          releaseOwnership();
        })();
      },
    };
  } catch (error) {
    await vite?.close();
    business.close();
    releaseOwnership();
    throw error;
  }
}
