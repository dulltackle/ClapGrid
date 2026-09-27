import { statusSchema, type ServiceStatus } from './contracts.js';

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
