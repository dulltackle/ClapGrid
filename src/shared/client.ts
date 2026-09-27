import { statusSchema, type ServiceStatus, type Batch, type BatchResult } from './contracts.js';

export async function queryStatus(baseUrl: string): Promise<ServiceStatus> {
  const response = await fetch(`${baseUrl}/api/status`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
  if (!response.ok) throw new Error(`服务查询失败：HTTP ${response.status}`);
  return statusSchema.parse(await response.json());
}

export function localServiceUrl(value = 'http://127.0.0.1:48762'): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('服务地址必须为 http://127.0.0.1:<端口>。');
  }
  return url.origin;
}

/** 成功响应表示事务已提交；超时/断线的结果未知，不自动重发。 */
export async function saveSegment(baseUrl: string, change: { text: string; id?: string }, token: string): Promise<ServiceStatus> {
  const response = await fetch(`${baseUrl}/api/segments/${change.id ? 'edit' : 'add'}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Edit-Token': token },
    body: JSON.stringify(change), signal: AbortSignal.timeout(5000), redirect: 'error',
  });
  if (!response.ok) {
    const body = await response.json();
    throw new Error(typeof body.error === 'string' ? body.error : `保存失败：HTTP ${response.status}`);
  }
  return statusSchema.parse(await response.json());
}

export async function modifyBatch(baseUrl: string, batch: Batch, signal?: AbortSignal): Promise<BatchResult> {
  const response = await fetch(`${baseUrl}/api/codex/modify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batch),
    signal: signal ?? AbortSignal.timeout(30000), redirect: 'error',
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `修改失败：HTTP ${response.status}`);
  return { ...body, status: statusSchema.parse(body.status) };
}

export type EditSession = { token: string; status: ServiceStatus; close: () => Promise<void>; closed: Promise<void> };

/** 连接覆盖整个编辑过程；不自动重连，失联后旧凭据不可用于保存。 */
export async function beginEdit(baseUrl: string): Promise<EditSession> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${baseUrl}/api/edit-session`, { method: 'POST', signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw new Error((await response.json()).error ?? '无法取得修改权');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let initial = '';
    while (!initial.includes('\n')) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('编辑连接已断开');
      initial += decoder.decode(chunk.value, { stream: true });
    }
    const data = JSON.parse(initial.split('\n')[0]!);
    const status = statusSchema.parse(data.status);
    const token: string = data.token;
    clearTimeout(timeout);
    const closed = (async () => {
      try { while (!(await reader.read()).done) { /* 消费连接心跳。 */ } }
      catch { /* 调用方通过 closed 处理断线，释放后也会正常结束。 */ }
    })();
    return {
      token, status, closed,
      async close() {
        try {
          await fetch(`${baseUrl}/api/edit-session/release`, {
            method: 'POST', headers: { 'X-Edit-Token': token }, signal: AbortSignal.timeout(3000), keepalive: true,
          });
        } finally { controller.abort(); }
      },
    };
  } catch (error) { controller.abort(); throw error; }
  finally { clearTimeout(timeout); }
}
