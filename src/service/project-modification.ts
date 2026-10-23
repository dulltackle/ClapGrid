import type { IncomingMessage, ServerResponse } from 'node:http';
import type { openBusiness } from '../business/index.js';
import type { ServiceStatus } from '../shared/contracts.js';

type Business = Pick<ReturnType<typeof openBusiness>, 'acquire' | 'release' | 'owns' | 'retainEdit' | 'getModification'>;
type Context = {
  request: IncomingMessage;
  response: ServerResponse;
  binding: string;
  verifyBinding: () => Promise<void>;
};
type Result = { data?: Record<string, unknown> } | { status: 400 | 409; error: string };

/** 请求负责协议与响应；业务仍在异步处理后、提交前核对修改权。 */
export function projectModification(business: Business, status: () => ServiceStatus) {
  const sessions = new Map<string, { binding: string; close: () => void }>();
  // 一次会话可以有多个在途请求；每个请求独立登记，迟到完成不能移除另一请求。
  const pending = new Set<{ binding: string; cancel: () => void }>();
  const releaseSession = (token: string) => {
    business.release(token);
    const session = sessions.get(token);
    sessions.delete(token);
    session?.close();
  };
  const json = (response: ServerResponse, body: unknown, code = 200) => {
    const bytes = JSON.stringify(body);
    response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(bytes);
  };
  const reject = (response: ServerResponse, code: number, error: string) => json(response, { error }, code);
  const revoke = (binding?: string) => {
    const errors: unknown[] = [];
    const attempt = (run: () => void) => { try { run(); } catch (error) { errors.push(error); } };
    for (const [token, session] of sessions) if (binding === undefined || session.binding === binding) attempt(() => releaseSession(token));
    for (const operation of pending) if (binding === undefined || operation.binding === binding) attempt(operation.cancel);
    if (errors.length) throw new AggregateError(errors, '项目修改撤销失败');
  };
  return {
    revokeBinding: (binding: string) => revoke(binding),
    revokeAll: () => revoke(),
    openSession({ request, response, binding, verifyBinding }: Context, verifyHeartbeat: () => Promise<void>) {
      if (request.method !== 'POST') { reject(response, 405, '请使用 POST 申请修改权。'); return; }
      let token: string;
      try { token = business.acquire('user', verifyBinding); }
      catch (error) { reject(response, 409, (error as Error).message); return; }
      try {
        const initial = { token, status: status() };
        response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
        response.write(JSON.stringify(initial) + '\n');
        let checking = false;
        const timer = setInterval(() => {
          if (response.destroyed) { releaseSession(token); return; }
          if (checking) return;
          checking = true;
          void verifyHeartbeat().then(() => { if (!response.destroyed) response.write('\n'); }, () => releaseSession(token)).finally(() => { checking = false; });
        }, 1000);
        sessions.set(token, { binding, close: () => { clearInterval(timer); response.end(); } });
        response.on('close', () => releaseSession(token));
      } catch {
        releaseSession(token);
        if (!response.headersSent) reject(response, 500, '读取项目失败，修改权已释放。');
        else response.destroy();
      }
    },
    releaseSession({ request, response }: Pick<Context, 'request' | 'response'>) {
      if (request.method !== 'POST') { reject(response, 405, '请使用 POST 释放修改权。'); return; }
      const token = request.headers['x-edit-token'];
      if (typeof token !== 'string') { reject(response, 400, '缺少修改权凭据。'); return; }
      releaseSession(token);
      json(response, { released: true });
    },
    async handle({ request, response, binding, verifyBinding }: Context, owner: 'user' | 'codex', process: (token: string, input: unknown) => Promise<Result>) {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST'); reject(response, 405, '请使用 POST 提交编辑。'); return;
      }
      if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
        reject(response, 415, '编辑请求必须使用 application/json。'); return;
      }
      let token: string;
      try {
        if (owner === 'codex') token = business.acquire(owner, verifyBinding);
        else {
          const supplied = request.headers['x-edit-token'];
          if (typeof supplied !== 'string' || !business.owns(supplied, owner)) {
            reject(response, 409, business.getModification()?.owner === 'codex' ? 'Codex 正在修改' : '请先取得用户修改权，修改权可能已失效。'); return;
          }
          token = supplied;
        }
      } catch (error) { reject(response, 409, (error as Error).message); return; }
      const completeEdit = business.retainEdit(token);
      const release = () => owner === 'codex' ? business.release(token) : releaseSession(token);
      const operation = { binding, cancel: release };
      pending.add(operation);
      response.on('close', () => { if (!response.writableFinished) release(); });
      const timeout = setTimeout(() => { release(); request.destroy(); }, 10000);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        if (owner === 'codex') release();
        pending.delete(operation);
        completeEdit();
      };
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 8 * 1024 * 1024) { reject(response, 413, '请求内容过大。'); return; }
          chunks.push(Buffer.from(chunk));
        }
        clearTimeout(timeout);
        let input: unknown;
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { reject(response, 400, '编辑请求格式无效。'); return; }
        await verifyBinding();
        if (!business.owns(token, owner)) {
          reject(response, 409, '修改权已失效，请重新读取项目后编辑。'); return;
        }
        const result = await process(token, input);
        // 处理函数返回意味着媒体和临时文件已确认清理；响应快照也必须反映释放后的占用。
        finish();
        if (!response.destroyed) {
          if ('error' in result) reject(response, result.status, result.error);
          else json(response, result.data ? { ...result.data, status: status() } : status());
        }
      } catch {
        if (!response.destroyed) reject(response, 500, '保存失败，未确认本次编辑已保存；请检查项目目录或数据库占用后重试。');
      } finally { finish(); }
    },
  };
}
