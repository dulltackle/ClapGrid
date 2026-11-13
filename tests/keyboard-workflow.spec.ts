import { randomUUID } from 'node:crypto';
import { test, expect } from './helpers/media-project.js';
import { querySpeech, submitSpeech } from '../src/shared/client.js';
import { holdResponse } from './helpers/response-gate.js';

// Chrome 131 的交集矩形会取整；允许亚像素误差，整像素裁切仍会失败。
const fullyVisible = { ratio: 0.999 };

test('逐句保存后光标落在下一句末尾，末句保存后回到本行', async ({ page, project }) => {
  const [first, last] = await project.seed(['第一句', '最后一句']);
  await page.goto(project.url);
  const cell = (id: string) => page.locator(`[row-id="${id}"] [col-id="text"]`);
  const input = page.getByRole('textbox', { name: '文案全文', exact: true });
  await cell(first!).locator('[data-segment-script]').click();
  await input.fill('已保存的第一句');
  await page.route('**/api/segments/edit', route => route.fulfill({ status: 500, json: { error: '文案暂时无法保存' } }));
  await input.press('Control+Enter');
  await expect(page.locator('[data-save-status]')).toHaveText('保存失败');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('已保存的第一句');
  expect((await project.status()).snapshot.segments[0]!.text).toBe('第一句');
  await page.unroute('**/api/segments/edit');
  await input.press('Control+Enter');
  await expect(input).toHaveValue('最后一句');
  await expect(input).toBeFocused();
  await input.pressSequentially('！');
  await expect(input).toHaveValue('最后一句！');
  await input.press('Meta+Enter');
  await expect(input).toHaveCount(0);
  await expect(cell(last!)).toBeFocused();
  expect((await project.status()).snapshot.segments.map(segment => segment.text)).toEqual(['已保存的第一句', '最后一句！']);
});

for (const shortcut of ['Enter', 'Control+Enter'] as const) test(`保存响应尚未返回时，长按 ${shortcut} 也只保存并前进一次`, async ({ page, project }) => {
  const [first, second] = await project.seed(['第一句', '第二句', '第三句']);
  await page.goto(project.url);
  await page.locator(`[row-id="${first}"] [data-segment-script]`).click();
  const input = page.getByRole('textbox', { name: '文案全文', exact: true });
  await input.fill('长按保存的第一句');
  const gate = await holdResponse(page, '/api/segments/edit');
  try {
    if (shortcut === 'Control+Enter') await page.keyboard.down('Control');
    await page.keyboard.down('Enter');
    await gate.received;
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    if (shortcut === 'Control+Enter') await page.keyboard.up('Control');
  } finally { gate.release(); }
  if (shortcut === 'Control+Enter') {
    await expect(input).toHaveValue('第二句');
    await expect(input).toBeFocused();
  } else {
    await expect(input).toHaveCount(0);
    await expect(page.locator(`[row-id="${second}"] [col-id="text"]`)).toBeFocused();
  }
  expect(gate.calls).toBe(1);
});

for (const [width, platform, key] of [[780, 'MacIntel', '⌘'], [601, 'Linux x86_64', 'Ctrl'], [360, 'Linux x86_64', 'Ctrl']] as const) {
  test(`文案输入框保留快捷键说明 ${width}`, async ({ page, project }, testInfo) => {
    await page.setViewportSize({ width, height: 360 });
    await page.addInitScript(value => { Object.defineProperty(navigator, 'platform', { value }); }, platform);
    await project.seed(['第一句', '第二句']);
    await page.goto(project.url);
    await page.getByText('第一句', { exact: true }).click();
    const help = `Enter 保存并移到下一行，Tab 保存并移到相邻单元格，Shift+Enter 换行，Esc 撤销。${key}+↵ 保存并编辑下一句 · Alt+↵ 仅保存`;
    const input = page.getByRole('textbox', { name: '文案全文' });
    await expect(input).toHaveAccessibleDescription(help);
    await expect(input).toBeFocused();
    await expect(input).toBeInViewport(fullyVisible);
    expect(await input.evaluate(node => {
      const style = getComputedStyle(node);
      return node.clientHeight - parseFloat(style.paddingTop) >= parseFloat(style.lineHeight);
    })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('keyboard-editor.png') });
  });
}

test('Alt+Enter 原位保存；组合输入时不触发两种保存快捷键', async ({ page, project }) => {
  const [first] = await project.seed(['第一句', '第二句']);
  await page.goto(project.url);
  const row = page.locator(`[row-id="${first}"]`);
  await row.locator('[data-segment-script]').click();
  const input = row.getByRole('textbox', { name: '文案全文', exact: true });
  await input.fill('原位保存的草稿');
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, ...modifiers });
  }
  await expect(input).toHaveValue('原位保存的草稿');
  await expect(input).toBeFocused();
  expect((await project.status()).snapshot.segments[0]!.text).toBe('第一句');
  await input.press('Alt+Enter');
  await expect(page.locator('[data-save-status]')).toHaveCount(0);
  await expect(input).toHaveValue('原位保存的草稿');
  await expect(input).toBeFocused();
  await expect(input).toBeEditable();
  expect((await project.status()).snapshot.segments[0]!.text).toBe('原位保存的草稿');
  await input.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('原位保存文案后，旧配音立即显示待更新', async ({ page, project }) => {
  const [id] = await project.seed(['配音文案']);
  await submitSpeech(project.url, { requestId: randomUUID(), segmentId: id! });
  await expect.poll(async () => (await querySpeech(project.url)).audio.length).toBe(1);
  await page.goto(project.url);
  await expect(page.getByRole('button', { name: '试听', exact: true })).toBeVisible();
  await page.getByText('配音文案', { exact: true }).click();
  const input = page.getByRole('textbox', { name: '文案全文', exact: true });
  await input.fill('已更改的配音文案'); await input.press('Alt+Enter');
  await expect(page.getByRole('button', { name: '试听旧配音', exact: true })).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toBeEditable();
});

test('表格行焦点支持方向键、两种菜单键和两个编辑入口', async ({ page, project }) => {
  const [first, second] = await project.seed(['第一句', '第二句']);
  await page.goto(project.url);
  const cell = (id: string) => page.locator(`[row-id="${id}"] [col-id="text"]`);
  await cell(first!).focus();
  await page.keyboard.press('ArrowDown');
  await expect(cell(second!)).toBeFocused();
  for (const key of ['Shift+F10', 'ContextMenu']) {
    await page.keyboard.press(key);
    await expect(page.getByRole('menu')).toContainText('片段 2');
    await page.keyboard.press('Escape');
    await expect(cell(second!)).toBeFocused();
  }
  await page.keyboard.press('ArrowUp');
  await expect(cell(first!)).toBeFocused();
  for (const key of ['Enter', 'F2']) {
    // 非文案单元格也是本行焦点；控件本身仍处理自己的快捷键。
    await page.locator(`[row-id="${first}"] [col-id="speech"]`).focus();
    await page.keyboard.press(key);
    const editor = page.getByRole('textbox', { name: '文案全文', exact: true });
    await expect(editor).toHaveValue('第一句');
    await expect(editor).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(cell(first!)).toBeFocused();
  }
});

test('配音锁定时顶部说明持续可见，仍能键盘播放有效和旧配音', async ({ page, project, speechControl }) => {
  const [valid, stale] = await project.seed(['有配音的片段', '将更新的片段']);
  for (const segmentId of [valid!, stale!]) {
    await submitSpeech(project.url, { requestId: randomUUID(), segmentId });
    await expect.poll(async () => (await querySpeech(project.url)).locked).toBe(false);
  }
  const previous = (await project.status()).snapshot.segments[1]!;
  await project.modify({ changes: [{ kind: 'edit', expected: previous, text: '已更新的片段' }] });
  speechControl.mode = 'pending';
  await submitSpeech(project.url, { requestId: randomUUID(), segmentId: stale! });
  try {
    await page.goto(project.url);
    const status = page.getByText('片段 2 配音中，暂不能修改文案；可以继续阅读和试听', { exact: true });
    await expect(status).toBeVisible();
    const grid = page.getByRole('grid');
    await expect(page.locator(`[row-id="${stale}"]`).getByRole('button', { name: '试听旧配音', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '拖动片段 2', exact: true })).toHaveCSS('opacity', '1');
    expect((await status.boundingBox())!.y).toBeLessThan((await grid.boundingBox())!.y);
    const script = page.getByText('已更新的片段', { exact: true });
    const baseline = await script.evaluate(node => {
      let opacity = 1;
      for (let el: Element | null = node; el; el = el.parentElement) opacity *= Number(getComputedStyle(el).opacity);
      return { color: getComputedStyle(node).color, opacity };
    });
    expect(baseline.opacity).toBe(1);
    const cell = page.locator(`[row-id="${valid}"] [col-id="text"]`);
    await cell.focus(); await page.keyboard.press('F2');
    await expect(page.getByRole('textbox', { name: '文案全文', exact: true })).toHaveCount(0);
    await script.click({ force: true });
    await expect(page.getByRole('textbox', { name: '文案全文', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '新增口播片段' })).toBeDisabled();
    await cell.focus();
    for (const [index, id] of [valid, stale].entries()) {
      const row = page.locator(`[row-id="${id}"]`);
      if (index) await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Space');
      await expect(row.getByRole('button', { name: '暂停试听', exact: true })).toBeVisible();
      await page.keyboard.press('Space');
      await expect(row.getByRole('button', { name: '继续试听', exact: true })).toBeVisible();
      await expect(row.getByRole('checkbox')).not.toBeChecked();
      await expect(status).toBeVisible();
    }
    speechControl.release();
    await expect(status).toHaveCount(0);
    await expect(page.getByRole('button', { name: '新增口播片段' })).toBeEnabled();
    await expect.poll(() => script.evaluate(node => getComputedStyle(node).color)).toBe(baseline.color);
  } finally { speechControl.release(); }
});

for (const width of [420, 780]) test(`单击其他单元格的空白处提交文案，失败保留草稿 ${width}`, async ({ page, project }) => {
  const [first, second] = await project.seed(['第一句', '第二句']);
  await page.setViewportSize({ width, height: 360 });
  await page.goto(project.url);
  await page.locator(`[row-id="${first}"] [data-segment-script]`).click();
  const input = page.getByLabel('文案全文', { exact: true });
  const cell = page.locator(`[row-id="${second}"] [col-id="materials"]`);
  await expect(cell).toBeVisible();
  const position = { x: (await cell.boundingBox())!.width - 8, y: 20 };
  await input.fill('准备保存的草稿');
  await page.route('**/api/segments/edit', route => route.fulfill({ status: 500, json: { error: '文案暂时无法保存' } }));
  await cell.click({ position });
  await expect(page.locator('[data-save-status]')).toHaveText('保存失败');
  await expect(input).toHaveValue('准备保存的草稿');
  expect((await project.status()).snapshot.segments[0]!.text).toBe('第一句');
  await page.unroute('**/api/segments/edit');
  await cell.click({ position });
  await expect(input).toHaveCount(0);
  await expect(cell).toBeFocused();
  expect((await project.status()).snapshot.segments[0]!.text).toBe('准备保存的草稿');
});
