import { test, expect } from './helpers/project.js';
import { holdRequest, holdResponse } from './helpers/response-gate.js';

test('保存中 Esc 不撤销请求，新查找取消迟到导航但接收保存结果', async ({ page, project }) => {
  const [a, b] = await project.seed(['A', 'B']); await page.goto(project.url);
  await page.locator(`[row-id="${a}"] [col-id="text"]`).press('F2');
  const input = page.getByLabel('文案全文', { exact: true }); await input.fill('已接收的 A');
  const gate = await holdResponse(page, '/api/segments/edit');
  try {
    await page.locator(`[row-id="${b}"] [col-id="text"]`).press('F2'); await gate.received;
    await input.press('Escape'); await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await page.getByRole('button', { name: '查找', exact: true }).click();
  } finally { gate.release(); }
  await gate.delivered;
  expect((await project.status()).snapshot.segments[0]!.text).toBe('已接收的 A');
  await expect(page.getByLabel('查找文案', { exact: true })).toBeFocused();
  await expect(page.getByLabel('文案全文', { exact: true })).toHaveCount(0);
});

test('显式保存迟到时保留新查找焦点，接收保存结果', async ({ page, project }) => {
  const [a] = await project.seed(['A', 'B']); await page.goto(project.url);
  await page.locator(`[row-id="${a}"] [col-id="text"]`).press('F2');
  const input = page.getByLabel('文案全文', { exact: true }); await input.fill('A 已保存');
  const gate = await holdResponse(page, '/api/segments/edit');
  try {
    await input.press('Control+Enter'); await gate.received;
    await page.getByRole('button', { name: '查找', exact: true }).click();
    await page.getByLabel('查找文案', { exact: true }).fill('B');
  } finally { gate.release(); }
  await gate.delivered; await expect(input).toHaveCount(0);
  await expect(page.getByLabel('查找文案', { exact: true })).toBeFocused();
  expect((await project.status()).snapshot.segments[0]!.text).toBe('A 已保存');
});
