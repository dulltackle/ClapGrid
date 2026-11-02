import { test, expect } from './helpers/project.js';

test('单击文案不进入编辑，双击才进入编辑', async ({ page, project }) => {
  const [id] = await project.seed(['双击编辑的文案']);
  await page.goto(project.url);
  const row = page.locator(`[row-id="${id}"]`);
  const script = row.locator('[data-segment-script]');
  await script.click();
  await expect(row.locator('[data-inline-editor]')).toHaveCount(0);
  await script.dblclick();
  await expect(page.getByLabel('文案全文', { exact: true })).toBeFocused();
});

test('编辑与保存不改变已有勾选，编辑器空格也不切换勾选', async ({ page, project }) => {
  const [a, b] = await project.seed(['原来勾选的片段', '待编辑的片段']);
  await page.goto(project.url);
  const selected = page.locator(`[row-id="${a}"]`).getByRole('checkbox');
  const row = page.locator(`[row-id="${b}"]`);
  const checkbox = row.getByRole('checkbox');
  await selected.check();
  await row.locator('[data-segment-script]').dblclick();
  const input = page.getByLabel('文案全文', { exact: true });
  await expect(input).toBeVisible();
  await expect(selected).toBeChecked();
  await expect(checkbox).not.toBeChecked();
  await input.click();
  await input.fill('更新'); await input.press('End'); await input.press('Space'); await input.pressSequentially('文案');
  await expect(input).toHaveValue('更新 文案');
  await expect(checkbox).not.toBeChecked();
  await row.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect.poll(async () => (await project.status()).snapshot.segments[1]!.text).toBe('更新 文案');
  await expect(selected).toBeChecked();
  await expect(checkbox).not.toBeChecked();
});
