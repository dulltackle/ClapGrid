import { test, expect } from './helpers/project.js';
import { holdRequest, holdResponse } from './helpers/response-gate.js';

for (const field of ['文案', '画面说明'] as const) test(`${field}保存失败保留草稿及来源，成功后才接续新详情`, async ({ page, project }) => {
  const [a, b] = await project.seed(['A', 'B']);
  await page.goto(project.url);
  await page.getByRole('button', { name: '查看片段 1 的详情', exact: true }).click();
  const input = page.getByLabel(`详情${field}`, { exact: true });
  await input.click(); await expect(input).toBeEditable(); await input.fill('A 新内容');
  await page.getByRole('button', { name: '查看片段 2 的详情', exact: true }).focus(); await page.keyboard.press('Enter');
  await page.route('**/api/segments/edit', route => route.fulfill({ status: 500, json: { error: '本例保存失败' } }));
  await page.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await expect(input).toHaveValue('A 新内容');
  await expect(page.getByRole('alertdialog').getByRole('alert')).toContainText('本例保存失败');
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(input).toBeFocused();
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.locator(`[row-id="${a}"] [data-row-details]`)).toBeFocused();
  await page.unroute('**/api/segments/edit');
  await page.getByRole('button', { name: '查看片段 1 的详情', exact: true }).click();
  await input.click(); await expect(input).toBeEditable(); await input.fill('A 成功内容');
  await page.getByRole('button', { name: '查看片段 2 的详情', exact: true }).focus(); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect(page.getByLabel('详情文案', { exact: true })).toHaveValue('B');
  const segment = (await project.status()).snapshot.segments[0]!;
  expect(field === '文案' ? segment.text : segment.visualNote).toBe('A 成功内容');
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await expect(page.locator(`[row-id="${b}"] [data-row-details]`)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator(`[row-id="${a}"] [role="gridcell"]`).first()).toBeFocused();
});

test('详情断线草稿不覆盖外部新文案，删除后仍可复制', async ({ page, project }) => {
  const [a] = await project.seed(['A']); await page.goto(project.url);
  await page.getByRole('button', { name: '查看片段 1 的详情', exact: true }).click();
  const input = page.getByLabel('详情文案', { exact: true });
  await input.click(); await expect(input).toBeEditable(); await input.fill('保留的草稿');
  await project.restart();
  await expect(page.getByRole('complementary').getByRole('alert')).toBeVisible();
  const before = (await project.status()).snapshot.segments[0]!;
  await project.modify({ changes: [{ kind: 'edit', expected: before, text: '外部新文案' }] });
  await page.getByRole('button', { name: '保存文案', exact: true }).click();
  await expect(page.getByRole('complementary').getByRole('alert')).toContainText('不能覆盖新内容');
  await expect(input).toHaveValue('保留的草稿');
  expect((await project.status()).snapshot.segments[0]!.text).toBe('外部新文案');
  const current = (await project.status()).snapshot.segments[0]!;
  await project.modify({ changes: [{ kind: 'delete', expected: current }] });
  await expect(page.getByText('仍可选中复制', { exact: false })).toBeVisible();
  await expect(input).toHaveAttribute('readonly', '');
  await expect(input).toBeEnabled(); await expect(input).toHaveValue('保留的草稿');
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.getByLabel('口播片段详情', { exact: true })).toHaveCount(0);
  expect(a).toBeTruthy();
});

test('内部浏览保留原来源，表格成功导航提交新来源', async ({ page, project }) => {
  const [a, b, c] = await project.seed(['A', 'B', 'C']); await page.goto(project.url);
  const first = page.locator(`[row-id="${a}"] [data-row-details]`);
  await first.focus(); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '下一条片段', exact: true }).click();
  await expect(page.getByLabel('详情文案', { exact: true })).toHaveValue('B');
  await page.getByRole('button', { name: '关闭详情', exact: true }).click(); await expect(first).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator(`[row-id="${b}"] [role="gridcell"]`).first()).toBeFocused();
  await first.click(); await page.locator(`[row-id="${b}"] [data-row-details]`).focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('详情文案', { exact: true })).toHaveValue('B');
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await expect(page.locator(`[row-id="${b}"] [data-row-details]`)).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(page.locator(`[row-id="${c}"] [role="gridcell"]`).first()).toBeFocused();
});

test('详情修改权迟到时离开再回容器也不复活旧意图', async ({ page, project }) => {
  const [a] = await project.seed(['A']); await page.goto(project.url);
  await page.locator(`[row-id="${a}"] [data-row-details]`).click();
  const gate = await holdRequest(page, '/api/edit-session');
  try {
    await page.getByLabel('详情画面说明', { exact: true }).click(); await gate.received;
    await page.getByRole('button', { name: '查找', exact: true }).click();
    await page.getByRole('complementary').getByRole('heading', { name: '画面素材', exact: true }).click();
    await page.getByLabel('口播片段详情', { exact: true }).focus();
  } finally { gate.release(); }
  await gate.answered;
  await expect.poll(async () => (await project.status()).modification).toBeNull();
  await expect(page.getByLabel('详情画面说明', { exact: true })).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('口播片段详情', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: '关闭查找', exact: true }).click();
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await expect(page.locator(`[row-id="${a}"] [data-row-details]`)).toBeFocused();
});

test('保存并继续期间新键盘意图取消迟到导航，保存结果仍接收', async ({ page, project }) => {
  const [a] = await project.seed(['A', 'B']); await page.goto(project.url);
  await page.locator(`[row-id="${a}"] [data-row-details]`).click();
  const input = page.getByLabel('详情文案', { exact: true });
  await input.click(); await expect(input).toBeEditable(); await input.fill('已接收的 A');
  await page.getByRole('button', { name: '查看片段 2 的详情', exact: true }).focus(); await page.keyboard.press('Enter');
  const gate = await holdResponse(page, '/api/segments/edit');
  try {
    await page.getByRole('button', { name: '保存并继续', exact: true }).click(); await gate.received;
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toBeVisible();
  } finally { gate.release(); }
  await gate.delivered;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(input).toHaveValue('已接收的 A');
  expect((await project.status()).snapshot.segments[0]!.text).toBe('已接收的 A');
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await expect(page.locator(`[row-id="${a}"] [data-row-details]`)).toBeFocused();
});
