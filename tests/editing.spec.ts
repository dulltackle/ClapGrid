import { test, expect } from './helpers/project.js';

for (const text of ['短句。', '欢迎来到 ClapGrid！今天用一分钟，体验从文案到口播视频的制作流程。']) test(`切换文案编辑时文字区域和周边布局保持稳定：${text}`, async ({ page, project }) => {
  const [id] = await project.seed([text]);
  await page.setViewportSize({ width: 780, height: 579 });
  await page.goto(project.url);
  const row = page.locator(`[row-id="${id}"]`);
  const script = row.locator('[data-segment-script]');
  const before = await script.evaluate(element => {
    const summary = element.querySelector('.text-summary')!;
    const rect = summary.getBoundingClientRect();
    const style = getComputedStyle(summary);
    return { x: rect.x, y: rect.y, width: rect.width, fontSize: style.fontSize, lineHeight: style.lineHeight };
  });
  const support = await row.locator('[data-segment-support]').boundingBox();
  const speech = await row.locator('[data-segment-speech]').boundingBox();
  await script.click();
  const input = page.getByLabel('文案全文', { exact: true });
  await expect(input).toBeFocused();
  const after = await input.evaluate(element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    const left = parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    const right = parseFloat(style.borderRightWidth) + parseFloat(style.paddingRight);
    return { x: rect.x + left, y: rect.y + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop), width: rect.width - left - right, fontSize: style.fontSize, lineHeight: style.lineHeight };
  });
  expect(after).toEqual(before);
  expect(await row.locator('[data-segment-support]').boundingBox()).toEqual(support);
  expect(await row.locator('[data-segment-speech]').boundingBox()).toEqual(speech);
});

test('单击进入文案编辑后光标位于末尾，不显示滚动条且输入保留原文', async ({ page, project }) => {
  const [id] = await project.seed(['保留这段原文']);
  await page.goto(project.url);
  await page.locator(`[row-id="${id}"] [data-segment-script]`).click();
  const input = page.getByLabel('文案全文', { exact: true });
  await expect(input).toBeFocused();
  expect(await input.evaluate(node => {
    const textarea = node as HTMLTextAreaElement;
    return textarea.selectionStart === textarea.value.length && textarea.selectionEnd === textarea.value.length;
  })).toBe(true);
  await expect(input).toHaveCSS('overflow-x', 'hidden');
  await expect(input).toHaveCSS('overflow-y', 'hidden');
  await input.pressSequentially('!');
  await expect(input).toHaveValue('保留这段原文!');
});

test('单击文案进入编辑，通过真实服务保存并在重载后保留', async ({ page, project }) => {
  const [id] = await project.seed(['原文']);
  await page.goto(project.url);
  await page.locator(`[row-id="${id}"] [data-segment-script]`).click();
  await page.getByLabel('文案全文', { exact: true }).fill('已保存的新文案');
  await page.getByLabel('文案全文', { exact: true }).press('Control+Enter');
  await expect(page.locator('[data-save-status]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator(`[row-id="${id}"] .text-summary`)).toHaveText('已保存的新文案');
  expect((await project.status()).snapshot.segments[0]!.text).toBe('已保存的新文案');
});

import { holdRequest, holdResponse } from './helpers/response-gate.js';

for (const same of [true, false]) test(`申请修改权期间连续点击${same ? '同一' : '其他'}文案仍进入最后点击的编辑目标`, async ({ page, project }) => {
  const [id, next] = await project.seed(['原文', '下一条']);
  await page.goto(project.url);
  const gate = await holdRequest(page, '/api/edit-session');
  try {
    await page.locator(`[row-id="${id}"] [data-segment-script]`).click();
    await gate.received;
    await page.locator(`[row-id="${same ? id : next}"] [data-segment-script]`).click();
  } finally { gate.release(); }
  const input = page.getByLabel('文案全文', { exact: true });
  await expect(input).toHaveValue(same ? '原文' : '下一条');
  await expect(input).toBeFocused();
  expect((await project.status()).modification?.owner).toBe('user');
});

test('保存草稿期间连续点击文案只提交一次并进入最后点击的目标', async ({ page, project }) => {
  const [a, b, c] = await project.seed(['A', 'B', 'C']);
  await page.goto(project.url);
  await page.locator(`[row-id="${a}"] [data-segment-script]`).click();
  const input = page.getByLabel('文案全文', { exact: true });
  await input.fill('A 草稿');
  const gate = await holdResponse(page, '/api/segments/edit');
  try {
    await page.locator(`[row-id="${b}"] [data-segment-script]`).click();
    await gate.received;
    await page.locator(`[row-id="${c}"] [data-segment-script]`).click();
  } finally { gate.release(); }
  await expect(input).toHaveValue('C');
  await expect(input).toBeFocused();
  expect(gate.calls).toBe(1);
  expect((await project.status()).snapshot.segments.map(segment => segment.text)).toEqual(['A 草稿', 'B', 'C']);
});

for (const width of [780, 420]) test(`原位编辑保留行高、画面上下文和内嵌操作 ${width}`, async ({ page, project }) => {
  const [id, next] = await project.seed(['原文', '下一条']);
  await page.setViewportSize({ width, height: 579 });
  await page.goto(project.url);
  const row = page.locator(`[row-id="${id}"]`);
  const initialHeight = (await row.boundingBox())!.height;
  await row.locator('[data-segment-script]').dblclick();
  const editor = row.locator('[data-inline-editor]');
  const input = page.getByLabel('文案全文', { exact: true });
  await expect(row).toHaveCSS('height', `${initialHeight}px`);
  await expect(editor.getByRole('button', { name: '片段 1 画面素材（0）' })).toBeInViewport();
  await expect(editor.getByRole('button', { name: '保存修改', exact: true })).toBeVisible();
  await expect.poll(async () => {
    const bounds = (await editor.boundingBox())!, support = (await editor.locator('[data-segment-support]').boundingBox())!;
    return bounds.height <= initialHeight && support.y + support.height <= bounds.y + bounds.height + 1;
  }).toBe(true);
  await expect(input).toHaveCSS('outline-style', 'none');
  await expect.poll(async () => {
    const current = (await row.boundingBox())!, following = (await page.locator(`[row-id="${next}"]`).boundingBox())!;
    return following.y >= current.y + current.height - 1;
  }).toBe(true);
  await input.fill('第一行'); await input.press('Enter'); await input.pressSequentially('第二行');
  await expect(input).toHaveValue('第一行\n第二行');
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await project.status()).snapshot.segments[0]!.text).toBe('第一行\n第二行');
  await expect(row).toHaveCSS('height', `${initialHeight}px`);
  await row.locator('[data-segment-script]').dblclick();
  await input.fill('不保存的草稿');
  await editor.getByRole('button', { name: '取消修改', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await project.status()).modification).toBeNull();
  expect((await project.status()).snapshot.segments[0]!.text).toBe('第一行\n第二行');
});

for (const [width, height] of [[780, 579], [420, 360]]) test(`原位放大缩小保留草稿、焦点与修改权 ${width}×${height}`, async ({ page, project }) => {
  const [id] = await project.seed(['原文']);
  await page.setViewportSize({ width: width!, height: height! });
  await page.goto(project.url);
  const row = page.locator(`[row-id="${id}"]`);
  await row.locator('[data-segment-script]').dblclick();
  const input = page.getByLabel('文案全文', { exact: true });
  const expand = row.getByRole('button', { name: '放大编辑', exact: true });
  await input.fill('原位草稿');
  await input.press('Home'); await input.press('Shift+ArrowRight'); await input.press('Shift+ArrowRight');
  const box = (await row.locator('[data-inline-text-box]').boundingBox())!;
  const button = (await expand.boundingBox())!;
  expect(button.x + button.width).toBeLessThanOrEqual(box.x + box.width);
  expect(button.y).toBeGreaterThanOrEqual(box.y);
  await expand.click();
  const dialog = page.getByRole('dialog', { name: '编辑口播文案 · 片段 1', exact: true });
  const large = page.getByLabel('放大文案全文', { exact: true });
  await expect(dialog).toBeVisible(); await expect(large).toBeFocused();
  await expect(large).toHaveValue('原位草稿');
  expect(await large.evaluate(node => [(node as HTMLTextAreaElement).selectionStart, (node as HTMLTextAreaElement).selectionEnd])).toEqual([0, 2]);
  await large.press('Tab');
  await expect(dialog.getByRole('button', { name: '取消修改', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(large).toBeFocused();
  expect((await project.status()).snapshot.segments[0]!.text).toBe('原文');
  expect((await project.status()).modification?.owner).toBe('user');
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width! + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(height! + 1);
  await large.fill('放大后修改\n第二行');
  await large.press('Home'); await large.press('Shift+ArrowRight'); await large.press('Shift+ArrowRight');
  await dialog.getByRole('button', { name: '缩小编辑', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(input).toBeFocused();
  await expect(input).toHaveValue('放大后修改\n第二行');
  expect(await input.evaluate(node => [(node as HTMLTextAreaElement).selectionStart, (node as HTMLTextAreaElement).selectionEnd])).toEqual([6, 8]);
  expect((await project.status()).snapshot.segments[0]!.text).toBe('原文');
  await expand.click(); await expect(large).toBeFocused();
  await large.press('Escape');
  await expect(dialog).toHaveCount(0); await expect(input).toBeFocused();
  await expect(input).toHaveValue('放大后修改\n第二行');
  await expand.click(); await expect(large).toBeFocused();
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await project.status()).snapshot.segments[0]!.text).toBe('放大后修改\n第二行');
  await expect.poll(async () => (await project.status()).modification).toBeNull();
  await row.locator('[data-segment-script]').dblclick(); await input.fill('不保存的放大草稿'); await expand.click();
  await expect(large).toBeFocused();
  await dialog.getByRole('button', { name: '取消修改', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(input).toHaveCount(0);
  await expect.poll(async () => (await project.status()).modification).toBeNull();
  expect((await project.status()).snapshot.segments[0]!.text).toBe('放大后修改\n第二行');
});

test('行内 Escape 取消且 Shift+Enter 保留多行输入', async ({ page, project }) => {
  const [id] = await project.seed(['原文']);
  await page.goto(project.url);
  const cell = page.locator(`[row-id="${id}"] [data-segment-script]`);
  const input = page.getByLabel('文案全文', { exact: true });
  await cell.dblclick(); await input.fill('取消的草稿'); await input.press('Escape');
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  expect((await project.status()).snapshot.segments[0]!.text).toBe('原文');
  await cell.dblclick(); await input.fill('第一行'); await input.press('Shift+Enter');
  await input.pressSequentially('第二行');
  await expect(input).toHaveValue('第一行\n第二行');
  // 浏览器不提供系统 IME 原语：这里只验证 editor 的 composition 兼容事件。
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true });
  await expect(input).toBeVisible();
  await input.press('Control+Enter');
  await expect.poll(async () => (await project.status()).snapshot.segments[0]!.text).toBe('第一行\n第二行');
});

test('相邻双击等待原行保存后进入新行，连接先关闭仍显示保存成功', async ({ page, project }) => {
  const [a, b] = await project.seed(['A', 'B']);
  await page.goto(project.url);
  await page.locator(`[row-id="${a}"] [data-segment-script]`).dblclick();
  await page.getByLabel('文案全文', { exact: true }).fill('A 新文案');
  const gate = await holdResponse(page, '/api/segments/edit');
  try {
    await page.locator(`[row-id="${b}"] [data-segment-script]`).dblclick();
    await gate.received;
    await expect(page.locator('[data-save-status]')).toContainText('保存中');
    expect((await project.status()).snapshot.segments[0]!.text).toBe('A 新文案');
  } finally { gate.release(); }
  await gate.delivered;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await expect(page.getByLabel('文案全文', { exact: true })).toHaveValue('B');
  await expect(page.getByLabel('文案全文', { exact: true })).toBeFocused();
  await expect(page.locator('[data-save-status]')).toHaveCount(0);
  expect(gate.calls).toBe(1);
});

test('真实页面关闭最终释放编辑修改权', async ({ page, project }) => {
  await project.seed(['A']); await page.goto(project.url);
  await page.locator('[data-segment-script]').dblclick();
  await expect(page.getByLabel('文案全文', { exact: true })).toBeEditable();
  expect((await project.status()).modification?.owner).toBe('user');
  await page.close();
  await expect.poll(async () => (await project.status()).modification).toBeNull();
});
