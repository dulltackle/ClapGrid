import { test, expect } from './helpers/project.js';
import { holdRequest, holdResponse } from './helpers/response-gate.js';

for (const viewport of [{ width: 1600, height: 1000 }, { width: 420, height: 360 }]) test(`粘贴按非空行新增且键盘和关闭可达 ${viewport.width}`, async ({ page, project }) => {
  await page.setViewportSize(viewport); await page.goto(project.url);
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '粘贴多行文案', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '粘贴多行文案', exact: true });
  const input = page.getByLabel('多行文案', { exact: true });
  const submit = page.getByRole('button', { name: '按非空行新增', exact: true });
  await expect(submit).toBeDisabled(); expect((await project.status()).modification).toBeNull();
  await input.click(); await page.keyboard.type('A'); await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); await page.keyboard.type('B');
  await expect(input).toHaveValue('A\n\nB');
  await page.keyboard.press('Tab'); await expect(submit).toBeFocused();
  await expect(input).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(input).toHaveCSS('border-top-style', 'solid');
  await submit.click();
  await expect(input).toHaveValue('');
  expect((await project.status()).snapshot.segments.map(segment => segment.text)).toEqual(['A', 'B']);
  expect((await project.status()).modification).toBeNull();
  for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    await expect(dialog).toContainText('按非空行新增');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.mouse.click(2, 2); await expect(dialog).toBeVisible();
  const close = page.getByRole('button', { name: '关闭', exact: true });
  await close.scrollIntoViewIfNeeded(); await expect(close).toBeInViewport();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: '更多', exact: true })).toBeFocused();
});

test('粘贴明确失败保留全部草稿，释放修改权后可再次提交', async ({ page, project }) => {
  await page.goto(project.url); await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '粘贴多行文案', exact: true }).click();
  const input = page.getByLabel('多行文案', { exact: true }); await input.fill('A\n\nB');
  await page.route('**/api/segments/modify', route => route.fulfill({ status: 500, json: { error: '本例粘贴失败' } }));
  await page.getByRole('button', { name: '按非空行新增', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('本例粘贴失败');
  await expect(input).toHaveValue('A\n\nB');
  expect((await project.status()).snapshot.segments).toEqual([]);
  await expect.poll(async () => (await project.status()).modification).toBeNull();
  await page.unroute('**/api/segments/modify');
  await page.getByRole('button', { name: '按非空行新增', exact: true }).click();
  await expect(input).toHaveValue('');
  expect((await project.status()).snapshot.segments.map(segment => segment.text)).toEqual(['A', 'B']);
});

test('粘贴获取权和提交中均拒绝关闭及重复操作', async ({ page, project }) => {
  await page.goto(project.url); await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '粘贴多行文案', exact: true }).click();
  const input = page.getByLabel('多行文案', { exact: true }); await input.fill('A\nB');
  const acquire = await holdRequest(page, '/api/edit-session');
  const save = await holdResponse(page, '/api/segments/modify');
  try {
    await page.getByRole('button', { name: '按非空行新增', exact: true }).click(); await acquire.received;
    await expect(input).toBeDisabled(); await expect(page.getByRole('button', { name: '关闭', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(input).toBeVisible();
    acquire.release(); await save.received;
    await page.keyboard.press('Escape'); await expect(input).toBeVisible();
    await expect(page.getByRole('button', { name: '按非空行新增', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '关闭', exact: true })).toBeDisabled();
  } finally { acquire.release(); save.release(); }
  await expect(input).toHaveValue(''); expect(save.calls).toBe(1);
});
