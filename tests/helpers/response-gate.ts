import type { Page } from '@playwright/test';

/** 只暂停本例的一个真实 HTTP 响应；不替换客户端、业务事务或浏览器生命周期。 */
export async function holdResponse(page: Page, path: string, occurrence = 1) {
  let release!: () => void;
  let reached!: () => void;
  let returned!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  const received = new Promise<void>(resolve => { reached = resolve; });
  const delivered = new Promise<void>(resolve => { returned = resolve; });
  let calls = 0;
  await page.route(`**${path}`, async route => {
    if (++calls !== occurrence) { await route.continue(); return; }
    const response = await route.fetch();
    reached();
    await released;
    await route.fulfill({ response });
    returned();
  });
  return { received, release, delivered, get calls() { return calls; } };
}

/** 长连接没有完整响应；只暂停申请发送，放行后仍使用真实 NDJSON 客户端。 */
export async function holdRequest(page: Page, path: string, occurrence = 1) {
  let release!: () => void;
  let reached!: () => void;
  let respond!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  const received = new Promise<void>(resolve => { reached = resolve; });
  const answered = new Promise<void>(resolve => { respond = resolve; });
  let calls = 0;
  await page.route(`**${path}`, async route => {
    if (++calls !== occurrence) { await route.continue(); return; }
    reached();
    await released;
    // 等首个真实响应事件，不读取持续 NDJSON body；确保未用受理前的空状态冒充释放。
    const response = page.waitForResponse(response => response.request() === route.request());
    await route.continue();
    await response;
    respond();
  });
  return { received, release, answered };
}
