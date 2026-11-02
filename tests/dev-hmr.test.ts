import { test } from './helpers/resource-test.js';
import { expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

test('多个开发预览各自复用 HTTP 端口并收到文件热更新', async ({ createDirectory, startService, openConnection }) => {
  const root = createDirectory(join(tmpdir(), 'clapgrid-hmr-'));
  const panelDirectory = resolve('src/panel');
  const probe = createDirectory(join(panelDirectory, 'hmr-probe-'));
  const file = join(probe, 'probe.css');
  const path = `/${basename(probe)}/probe.css`;
  writeFileSync(file, 'body { --hmr-probe: 1; }');
  const services = [];
  for (const name of ['first', 'second']) {
    services.push(await startService({ projectDirectory: join(root, name), panelDirectory, port: 0, dev: true }));
  }
  const messages: Array<Array<{ type: string; updates?: Array<{ path: string }> }>> = [];
  const sockets: WebSocket[] = [];
  for (const service of services) {
    const client = await (await fetch(`${service.url}/@vite/client`)).text();
    const token = /const wsToken = "([^"]+)"/.exec(client)?.[1];
    expect(token).toBeTruthy();
    const received: (typeof messages)[number] = [];
    messages.push(received);
    const socket = openConnection(() => new WebSocket(`${service.url.replace('http:', 'ws:')}/?token=${token}`, 'vite-hmr'));
    sockets.push(socket);
    socket.addEventListener('message', event => received.push(JSON.parse(String(event.data))));
    socket.addEventListener('error', () => {});
    await expect.poll(() => received.some(message => message.type === 'connected'), { timeout: 2000 }).toBe(true);
    expect((await fetch(`${service.url}${path}`)).status).toBe(200);
  }
  writeFileSync(file, 'body { --hmr-probe: 2; }');
  for (const received of messages) {
    await expect.poll(() => received.some(message => message.type === 'update' && message.updates?.some(update => update.path === path))).toBe(true);
  }
  // 浏览器仍保持 HMR 连接时，停止服务也必须正常释放连接和项目保护。
  for (const service of services) await service.close();
  await expect.poll(() => sockets.every(socket => socket.readyState === WebSocket.CLOSED)).toBe(true);
});
