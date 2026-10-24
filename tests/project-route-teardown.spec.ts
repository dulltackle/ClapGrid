import { test as base, expect } from './helpers/project.js';
import { startService } from '../src/service/server.js';

let releaseFetch!: () => void;
let requestCompleted = false;
let released: Promise<void>;
const test = base.extend({
  projectServer: [async ({}, use) => {
    await use(async options => {
      requestCompleted = false;
      released = new Promise<void>(resolve => { releaseFetch = resolve; });
      const service = await startService(options);
      return { ...service, async close() {
        try { expect(requestCompleted, '服务关闭前必须完成页面路由中的真实 HTTP 请求').toBe(true); }
        finally { await service.close(); }
      } };
    });
  }, { scope: 'worker' }],
});

test.afterEach(() => { releaseFetch(); });

for (const scope of ['page', 'context'] as const) test(`项目清理等待仍在执行的 ${scope} 路由完成`, async ({ page, context, project }) => {
  await page.goto(project.url);
  let entered!: () => void;
  const received = new Promise<void>(resolve => { entered = resolve; });
  await (scope === 'page' ? page : context).route('**/api/exports', async route => {
    entered();
    await released;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.fulfill({ response });
    requestCompleted = true;
  });
  await page.evaluate(() => { void fetch('/api/exports'); });
  await received;
});
