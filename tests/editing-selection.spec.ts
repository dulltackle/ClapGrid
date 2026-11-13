import { test, expect } from './helpers/project.js';
import { holdRequest } from './helpers/response-gate.js';

for (const entry of ['首次进入', '切换'] as const) test(`${entry}文案编辑全程没有单元格蓝框和新增、配音按钮及序号闪动`, async ({ page, project }) => {
  const ids = await project.seed(['第一句', '第二句', '第三句']);
  await page.setViewportSize({ width: 780, height: 579 });
  await page.goto(project.url);
  const add = page.getByRole('button', { name: '新增口播片段', exact: true });
  await expect(add).toBeEnabled();
  await expect(add).toHaveCSS('opacity', '1');
  if (entry === '切换') {
    await page.locator(`[row-id="${ids[0]}"] [data-segment-script]`).click();
    await expect(page.getByLabel('文案全文', { exact: true })).toBeEditable();
  }
  const frames = page.evaluate(async () => {
    const samples: { opacity: string; x: number; y: number; width: number; height: number; label: string; border?: string }[][] = [];
    const sample = () => {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>('header button, [data-segment-speech] > button, [col-id="order"] button')]
        .filter(element => element.querySelector('[data-segment-order]') || ['新增口播片段', '生成配音'].includes(element.textContent!.trim()));
      samples.push(buttons.map(element => {
        const rect = element.getBoundingClientRect();
        const rowTop = element.closest('[row-id]')?.getBoundingClientRect().y ?? 0;
        return { opacity: getComputedStyle(element).opacity, x: rect.x, y: rect.y - rowTop, width: rect.width, height: rect.height, label: element.textContent!.trim() };
      }));
      const focusedCell = document.querySelector('.ag-cell-focus');
      if (focusedCell) samples.at(-1)!.push({ opacity: '', x: 0, y: 0, width: 0, height: 0, label: '单元格', border: getComputedStyle(focusedCell).borderTopColor });
    };
    sample();
    await new Promise<void>(resolve => {
      const started = performance.now();
      const frame = () => { sample(); if (performance.now() - started < 1000) requestAnimationFrame(frame); else resolve(); };
      requestAnimationFrame(frame);
    });
    return samples;
  });
  await page.locator(`[row-id="${ids[1]}"] [data-segment-script]`).click();
  await expect(page.getByLabel('文案全文', { exact: true })).toHaveValue('第二句');
  const samples = await frames;
  const failures = samples.flatMap(sample => sample.filter(item => item.label === '单元格' ? item.border !== 'rgba(0, 0, 0, 0)' : item.opacity !== '1'));
  expect(failures).toEqual([]);
  const initial = samples[0]!.filter(item => item.label !== '单元格');
  for (const sample of samples) expect(sample.filter(item => item.label !== '单元格').map(({ opacity, ...layout }) => layout)).toEqual(initial.map(({ opacity, ...layout }) => layout));
});

for (const behavior of ['滚动位置', '单元格边框']) test(`点击下方文案进入编辑时保持${behavior}`, async ({ page, project }) => {
  const ids = await project.seed(Array.from({ length: 10 }, (_, index) => `第 ${index + 1} 条口播文案`));
  await page.setViewportSize({ width: 780, height: 579 });
  await page.goto(project.url);
  const scroller = page.locator('.ag-grid-viewport');
  await scroller.evaluate(element => { element.scrollTop = 150; });
  const before = await scroller.evaluate(element => element.scrollTop);
  const cell = page.locator(`[row-id="${ids[4]}"] [col-id="text"]`);
  await cell.locator('[data-segment-script]').click();
  await expect(page.getByLabel('文案全文', { exact: true })).toBeFocused();
  if (behavior === '滚动位置') expect(await scroller.evaluate(element => element.scrollTop)).toBe(before);
  else await expect(cell).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
});

test('申请文案修改权期间配音按钮保持外观且仍阻止重复操作', async ({ page, project }) => {
  const [id] = await project.seed(['第一句', '第二句', '第三句']);
  await page.goto(project.url);
  const buttons = page.getByRole('button', { name: '生成配音', exact: true });
  await expect(buttons).toHaveCount(3);
  const gate = await holdRequest(page, '/api/edit-session');
  try {
    await page.locator(`[row-id="${id}"] [data-segment-script]`).click();
    await gate.received;
    await expect(buttons.first()).toBeDisabled();
    const order = page.getByRole('button', { name: '拖动片段 1', exact: true });
    await expect(order).toBeDisabled();
    await expect(order).toHaveCSS('opacity', '1');
    // 等待按钮的 CSS 过渡结束，检查申请期间持续显示的实际外观。
    await page.waitForTimeout(250);
    for (const button of await buttons.all()) expect(await button.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  } finally { gate.release(); }
  await expect(page.getByLabel('文案全文', { exact: true })).toBeEditable();
  for (const button of await buttons.all()) {
    await expect(button).toBeEnabled();
    await expect(button).toHaveCSS('opacity', '1');
  }
});

test('单击文案直接进入编辑并取得修改权', async ({ page, project }) => {
  const [id] = await project.seed(['单击编辑的文案']);
  await page.goto(project.url);
  const row = page.locator(`[row-id="${id}"]`);
  const script = row.locator('[data-segment-script]');
  await script.click();
  await expect(row.locator('[data-inline-editor]')).toHaveCount(1);
  await expect(page.getByLabel('文案全文', { exact: true })).toBeFocused();
  expect((await project.status()).modification?.owner).toBe('user');
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
  await input.press('Enter');
  await expect.poll(async () => (await project.status()).snapshot.segments[1]!.text).toBe('更新 文案');
  await expect(selected).toBeChecked();
  await expect(checkbox).not.toBeChecked();
});
