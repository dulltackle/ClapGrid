import { test as base, expect } from '@playwright/test';
import { createServer } from 'vite';
import { resolve } from 'node:path';

const test = base.extend<{}, { moduleUrl: string }>({
  moduleUrl: [async ({}, use) => {
    // 标准 Vite 只服务此具体模块夹具；原生 fixture 拥有与清理服务。
    const server = await createServer({
      configFile: false, root: resolve('tests/fixtures'),
      server: { host: '127.0.0.1', port: 0, ws: false, fs: { allow: [resolve('.')] } },
    });
    try { await server.listen(); await use(server.resolvedUrls!.local[0]! + 'focus-module.html'); }
    finally { await server.close(); }
  }, { scope: 'worker' }],
});

test.beforeEach(async ({ page, moduleUrl }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  await page.goto(moduleUrl);
  await expect.poll(() => page.evaluate(() => !!window.focusFixture)).toBe(true);
});

for (const stage of ['首帧前', '首帧后'] as const) for (const change of ['重排', '删除'] as const) {
  test(`焦点模块${stage}${change}按当前稳定身份或显示位置返回`, async ({ page }) => {
    await page.evaluate(() => { window.focusFixture.capture(); window.focusFixture.hideTargets(true); window.focusFixture.close(); });
    if (stage === '首帧后') {
      await page.clock.runFor(20);
      expect(await page.evaluate(() => window.focusFixture.lookups)).toBeGreaterThan(0);
      await expect(page.getByRole('button', { name: '查找', exact: true })).not.toBeFocused();
    }
    await page.evaluate(change => {
      window.focusFixture.rows(change === '重排' ? ['b', 'c', 'a'] : ['b', 'c']);
      window.focusFixture.hideTargets(false);
    }, change);
    await page.clock.runFor(100);
    await expect(page.locator(`[row-id="${change === '重排' ? 'a' : 'b'}"] [col-id="text"]`)).toBeFocused();
  });
}

for (const unavailable of ['disabled', 'hidden', 'detached'] as const) {
  test(`焦点模块逐级跳过${unavailable}后备且空表不补跳`, async ({ page }) => {
    await page.evaluate(unavailable => {
      window.focusFixture.capture(); window.focusFixture.rows([]);
      for (const id of ['search', 'table']) {
        const target = document.getElementById(id)! as HTMLInputElement;
        if (unavailable === 'detached') target.remove();
        else if (unavailable === 'hidden') target.hidden = true;
        else target.disabled = true;
      }
      window.focusFixture.close();
    }, unavailable);
    await page.clock.runFor(100);
    await expect(page.getByRole('button', { name: '更多', exact: true })).toBeFocused();
    await page.evaluate(() => window.focusFixture.rows(['a', 'b']));
    await page.clock.runFor(100);
    await expect(page.getByRole('button', { name: '更多', exact: true })).toBeFocused();
  });
}

test('焦点模块有限帧耗尽后使用后备且迟到目标不抢回', async ({ page }) => {
  await page.evaluate(() => { window.focusFixture.capture(); window.focusFixture.hideTargets(true); window.focusFixture.close(); });
  await page.clock.runFor(100);
  expect(await page.evaluate(() => window.focusFixture.lookups)).toBeGreaterThan(0);
  await expect(page.getByLabel('查找文案')).toBeFocused();
  await page.evaluate(() => window.focusFixture.hideTargets(false));
  await page.clock.runFor(100);
  await expect(page.getByLabel('查找文案')).toBeFocused();
});

test('焦点模块没有可用候选时终止且迟到候选不补恢复', async ({ page }) => {
  await page.evaluate(() => {
    window.focusFixture.capture(); window.focusFixture.rows([]);
    document.querySelectorAll<HTMLInputElement>('input, button').forEach(node => { node.disabled = true; });
    window.focusFixture.close();
  });
  await page.clock.runFor(100);
  await expect(page.locator('body')).toBeFocused();
  await page.evaluate(() => {
    document.querySelectorAll<HTMLInputElement>('input, button').forEach(node => { node.disabled = false; });
    window.focusFixture.rows(['a']);
  });
  await page.clock.runFor(100);
  await expect(page.locator('body')).toBeFocused();
});

for (const mode of ['disabled', 'hidden'] as const) test(`查找输入${mode}后仍可返回表格后备`, async ({ page }) => {
  await page.evaluate(mode => {
    window.focusFixture.capture(); window.focusFixture.rows([]);
    const search = document.getElementById('search')! as HTMLInputElement;
    search.value = '原条件';
    if (mode === 'disabled') search.disabled = true; else search.hidden = true;
    window.focusFixture.close();
  }, mode);
  await page.clock.runFor(100);
  await expect(page.getByRole('button', { name: '查找', exact: true })).toBeFocused();
  await expect(page.locator('#search')).toHaveValue('原条件');
});

test('焦点模块原显示位置越界时回当前末行', async ({ page }) => {
  await page.evaluate(() => {
    window.focusFixture.rows(Array.from({ length: 80 }, (_, i) => String(i)));
    window.focusFixture.capture('79');
    window.focusFixture.rows(Array.from({ length: 21 }, (_, i) => String(i)));
    window.focusFixture.close();
  });
  await page.clock.runFor(100);
  await expect(page.locator('[row-id="20"] [col-id="text"]')).toBeFocused();
});

test('焦点模块离页再返回使旧意图失效，Escape 不擅自取消业务允许的返回', async ({ page }) => {
  await page.evaluate(() => {
    window.focusFixture.capture(); window.focusFixture.close();
    // 这里只核对生命周期事件处理；真实页面关闭另由 editing.spec.ts 受测。
    window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('pageshow'));
  });
  await page.clock.runFor(100);
  await expect(page.locator('[row-id="a"] [col-id="text"]')).not.toBeFocused();
  await page.evaluate(() => { window.focusFixture.capture(); window.focusFixture.close(); });
  await page.keyboard.press('Escape');
  await page.clock.runFor(100);
  await expect(page.locator('[row-id="a"] [col-id="text"]')).toBeFocused();
});

for (const input of ['pointer', 'keyboard', 'input', 'wheel'] as const) {
  test(`焦点模块真实${input}输入撤销旧帧，悬停不撤销`, async ({ page }) => {
    await page.evaluate(() => { window.focusFixture.capture(); window.focusFixture.close(); });
    if (input === 'pointer') await page.mouse.click(800, 400);
    else if (input === 'keyboard') await page.keyboard.press('Tab');
    else if (input === 'input') await page.getByLabel('查找文案').fill('新条件');
    else await page.mouse.wheel(0, 100);
    // wheel 发送返回不等于浏览器已经分派事件；先观察产品意图失效，再推进旧帧。
    await expect.poll(() => page.evaluate(() => window.focusFixture.intentValid)).toBe(false);
    const active = await page.evaluate(() => document.activeElement?.outerHTML);
    await page.clock.runFor(100);
    expect(await page.evaluate(() => document.activeElement?.outerHTML)).toBe(active);
    await expect(page.locator('[row-id="a"] [col-id="text"]')).not.toBeFocused();
    await page.evaluate(() => { window.focusFixture.capture(); window.focusFixture.close(); });
    await page.mouse.move(700, 300);
    await page.clock.runFor(100);
    await expect(page.locator('[row-id="a"] [col-id="text"]')).toBeFocused();
  });
}
