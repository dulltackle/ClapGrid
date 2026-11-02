import { test, expect } from './helpers/project.js';
import { holdRequest, holdResponse } from './helpers/response-gate.js';

test('同片段文案切换说明保存失败保留原位置，重试成功只保留一个编辑位置', async ({ page, project }) => {
  const [a] = await project.seed(['A']); await page.goto(project.url);
  const row = page.locator(`[row-id="${a}"]`);
  await row.getByRole('button', { name: '展开片段 1 的画面说明', exact: true }).click();
  await row.locator('[col-id="text"]').press('F2');
  const input = page.getByLabel('文案全文', { exact: true }); await input.fill('A 新内容');
  await page.route('**/api/segments/edit', route => route.fulfill({ status: 500, json: { error: '本例保存失败' } }));
  await page.getByRole('button', { name: '编辑说明', exact: true }).press('Enter');
  await expect(input).toHaveValue('A 新内容'); await expect(page.locator('footer')).toContainText('本例保存失败');
  await expect(page.getByLabel('画面说明全文', { exact: true })).toHaveCount(0);
  await page.unroute('**/api/segments/edit');
  await page.getByRole('button', { name: '编辑说明', exact: true }).press('Enter');
  await expect(page.getByLabel('画面说明全文', { exact: true })).toBeFocused();
  await expect(input).toHaveCount(0);
  expect((await project.status()).snapshot.segments[0]!.text).toBe('A 新内容');
});

test('说明申请修改权迟到时新查找取消编辑意图并释放修改权', async ({ page, project }) => {
  await project.seed(['A']); await page.goto(project.url);
  await page.getByRole('button', { name: '展开片段 1 的画面说明', exact: true }).press('Enter');
  const gate = await holdRequest(page, '/api/edit-session');
  try {
    await page.getByRole('button', { name: '编辑说明', exact: true }).press('Enter'); await gate.received;
    await page.getByRole('button', { name: '查找', exact: true }).click();
  } finally { gate.release(); }
  await gate.answered;
  await expect.poll(async () => (await project.status()).modification).toBeNull();
  await expect(page.getByLabel('画面说明全文', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('查找文案', { exact: true })).toBeFocused();
});

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
