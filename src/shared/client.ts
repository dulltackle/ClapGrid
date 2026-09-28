import { statusSchema, type ServiceStatus, type Batch, type BatchResult, queryResultSchema, type SegmentScope, type ScopedOperation } from './contracts.js';

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
    signal: signal ?? (batch.changes.some(change => change.kind === 'video') ? undefined : AbortSignal.timeout(30000)), redirect: 'error',
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


async function postJson(baseUrl: string, path: string, input: unknown, token?: string, signal?: AbortSignal | null) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Edit-Token': token } : {}) },
    body: JSON.stringify(input), signal: signal === null ? undefined : signal ?? AbortSignal.timeout(30000), redirect: 'error',
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `请求失败：HTTP ${response.status}`);
  return body;
}

export async function querySegments(baseUrl: string, scope: SegmentScope) {
  return queryResultSchema.parse(await postJson(baseUrl, '/api/segments/query', { scope }));
}
export async function processSegments(baseUrl: string, input: ScopedOperation, signal?: AbortSignal): Promise<BatchResult> {
  const body = await postJson(baseUrl, '/api/codex/process', input, undefined, signal);
  return { ...body, status: statusSchema.parse(body.status) };
}
export async function modifyUserBatch(baseUrl: string, input: Batch, token: string, signal?: AbortSignal): Promise<BatchResult> {
  // 媒体校验由服务端逐进程限时；不能沿用短文本编辑的 30 秒总超时。
  const body = await postJson(baseUrl, '/api/segments/modify', input, token, signal ?? (input.changes.some(change => change.kind === 'video') ? null : undefined));
  return { ...body, status: statusSchema.parse(body.status) };
}

export type TableSession = { tableId: string; select: (ids: string[]) => Promise<void>; close: () => Promise<void>; closed: Promise<void> };

/** 表格连接只保存临时勾选，不占用项目修改权；失联后禁止沿用旧选择。 */
export async function connectTable(baseUrl: string): Promise<TableSession> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${baseUrl}/api/table-session`, { method: 'POST', signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw new Error('表格选择连接失败');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let initial = '';
    while (!initial.includes('\n')) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('表格选择连接已断开');
      initial += decoder.decode(chunk.value, { stream: true });
    }
    const { tableId } = JSON.parse(initial.split('\n')[0]!);
    clearTimeout(timeout);
    const closed = (async () => {
      try { while (!(await reader.read()).done) { /* 消费心跳。 */ } } catch { /* 调用方收到 closed。 */ }
    })();
    // 顺序发送勾选变化，避免较早的请求迟到覆盖新选择。
    let queue = Promise.resolve();
    let active = true;
    return {
      tableId, closed,
      select(ids) {
        const snapshot = [...ids];
        queue = queue.then(async () => {
          if (!active) throw new Error('表格选择连接已断开');
          await postJson(baseUrl, '/api/table-selection', { tableId, ids: snapshot }, undefined, AbortSignal.timeout(5000));
        });
        return queue;
      },
      async close() {
        active = false;
        controller.abort();
        await fetch(`${baseUrl}/api/table-session/release`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tableId }),
          signal: AbortSignal.timeout(3000), keepalive: true, redirect: 'error',
        }).catch(() => {});
      },
    };
  } catch (error) { controller.abort(); throw error; }
  finally { clearTimeout(timeout); }
}

/** 导入仅接收用户明确指定的文件；不自动扫描路径或重试。 */
export async function importVideo(baseUrl: string, sourcePath: string, token?: string, signal?: AbortSignal) {
  const response = await fetch(`${baseUrl}${token ? '/api/video/import' : '/api/codex/import-video'}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Edit-Token': token } : {}) },
    body: JSON.stringify({ sourcePath }), signal, redirect: 'error',
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? '视频导入失败');
  return { asset: body.asset as import('./contracts.js').VideoAsset, status: statusSchema.parse(body.status) };
}

export async function querySpeech(baseUrl: string): Promise<import('./contracts.js').SpeechStatus> {
  const response = await fetch(`${baseUrl}/api/speech`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw new Error('配音状态查询失败');
  return response.json();
}
export async function submitSpeech(baseUrl: string, input: { requestId: string; segmentId: string }): Promise<import('./contracts.js').SpeechTask> {
  let response: Response; let body: any;
  try {
    response = await fetch(`${baseUrl}/api/speech/submit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      signal: AbortSignal.timeout(5000), redirect: 'error',
    });
    body = await response.json();
  } catch {
    throw new Error(`提交未确认，请使用同一请求标识 ${input.requestId} 查询或重发；不会自动生成新请求。`);
  }
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : '配音请求被拒绝');
  return body;
}
export async function setVoice(baseUrl: string, input: import('./contracts.js').Voice) {
  return postJson(baseUrl, '/api/speech/voice', input, undefined, AbortSignal.timeout(5000));
}

export async function queryExportSettings(baseUrl: string): Promise<import('./contracts.js').ExportStatus> {
  const response = await fetch(`${baseUrl}/api/export-settings`, { signal: AbortSignal.timeout(45000), redirect: 'error' });
  if (!response.ok) throw new Error('读取导出设置失败，请检查本地服务');
  return response.json();
}
export async function saveExportSettings(baseUrl: string, input: import('./contracts.js').UpdateExportSettings, token?: string, signal?: AbortSignal): Promise<{ settings: import('./contracts.js').ExportSettings; status: ServiceStatus }> {
  const response = await fetch(`${baseUrl}/api/${token ? '' : 'codex/'}export-settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Edit-Token': token } : {}) },
    body: JSON.stringify(input), signal: signal ?? AbortSignal.timeout(45000), redirect: 'error',
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? '导出设置保存失败，请重新查询确认结果');
  return { settings: body.settings, status: statusSchema.parse(body.status) };
}
