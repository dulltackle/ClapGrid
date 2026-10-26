import { test, expect } from './helpers/project.js';
import { holdResponse } from './helpers/response-gate.js';

for (const width of [1600, 780, 420]) test(`勾选与浏览、编辑、菜单和取消拖动独立 ${width}`, async ({ page, project }) => {
  await page.setViewportSize({ width, height: 579 });
  const [a, b, c, d] = await project.seed(['A', 'B', 'C', 'D']);
  await page.goto(project.url);
  const row = (id: string) => page.locator(`[row-id="${id}"]`);
  const checked = () => page.locator('.ag-row[aria-selected="true"]').evaluateAll(rows => rows.map(row => row.getAttribute('row-id')).sort());
  await row(a!).locator('input[type="checkbox"]').click();
  await row(c!).locator('input[type="checkbox"]').click();
  await row(b!).locator('[col-id="order"]').click();
  await expect.poll(checked).toEqual([a, c].sort());
  await row(b!).locator('[data-segment-script]').dblclick();
  const input = page.getByLabel('文案全文', { exact: true });
  await input.fill('B 已修改');
  await row(a!).locator('input[type="checkbox"]').click();
  await row(a!).locator('input[type="checkbox"]').click();
  await expect(input).toHaveValue('B 已修改');
  expect((await project.status()).snapshot.segments[1]!.text).toBe('B');
  await expect(page.locator('[data-save-status]')).toHaveText('未保存');
  await page.getByRole('button', { name: '查看片段 4 的详情', exact: true }).click();
  await expect(page.getByLabel('详情文案', { exact: true })).toHaveValue('D');
  expect((await project.status()).snapshot.segments[1]!.text).toBe('B 已修改');
  await page.getByLabel('详情文案', { exact: true }).focus();
  expect((await project.status()).modification).toBeNull();
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await row(b!).locator('[data-segment-script]').click({ button: 'right' });
  await expect(page.getByRole('menu')).toContainText('片段 2');
  await expect(page.getByRole('menuitem', { name: '删除本片段', exact: true })).toBeVisible();
  await expect.poll(checked).toEqual([a, c].sort());
  await page.keyboard.press('Escape');
  const handle = row(b!).getByRole('button', { name: '拖动片段 2', exact: true });
  await handle.hover(); const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  const target = (await row(c!).locator('[col-id="order"]').boundingBox())!;
  await page.mouse.move(target.x + 10, target.y + 20, { steps: 5 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await page.keyboard.press('Escape');
  await expect.poll(checked).toEqual([a, c].sort());
  expect((await project.status()).snapshot.segments.map(segment => segment.id)).toEqual([a, b, c, d]);
  await page.getByRole('button', { name: '清空勾选', exact: true }).click();
  await expect.poll(checked).toEqual([]);
});

test('保存失败保留原位草稿并阻止查看与删除，重试后只导航到最新目标', async ({ page, project }) => {
  const [a] = await project.seed(['A', 'B', 'C', 'D']); await page.goto(project.url);
  await page.locator(`[row-id="${a}"] [data-segment-script]`).dblclick();
  const input = page.getByLabel('文案全文', { exact: true }); await input.fill('保留草稿');
  await page.route('**/api/segments/edit', route => route.fulfill({ status: 500, json: { error: '本例保存失败' } }));
  await page.getByRole('button', { name: '查看片段 2 的详情', exact: true }).click();
  await expect(input).toHaveValue('保留草稿');
  await expect(page.locator('footer')).toContainText('本例保存失败');
  await expect(page.getByLabel('口播片段详情', { exact: true })).toHaveCount(0);
  await page.unroute('**/api/segments/edit');
  const gate = await holdResponse(page, '/api/segments/edit');
  try {
    await page.getByRole('button', { name: '查看片段 2 的详情', exact: true }).click(); await gate.received;
    await page.getByRole('button', { name: '查看片段 3 的详情', exact: true }).click();
    await page.getByRole('button', { name: '查看片段 4 的详情', exact: true }).click();
  } finally { gate.release(); }
  await gate.delivered;
  await expect(page.getByLabel('详情文案', { exact: true })).toHaveValue('D');
  expect((await project.status()).snapshot.segments[0]!.text).toBe('保留草稿');
});

for (const entry of ['原位', '详情'] as const) test(`${entry}草稿在确认删除前保持，确认后保存再删除固定范围`, async ({ page, project }) => {
  const [a, b, c] = await project.seed(['A', 'B', 'C']); await page.goto(project.url);
  const row = (id: string) => page.locator(`[row-id="${id}"]`);
  await row(a!).locator('input[type="checkbox"]').click(); await row(c!).locator('input[type="checkbox"]').click();
  if (entry === '详情') {
    await page.getByRole('button', { name: '查看片段 2 的详情', exact: true }).click();
    await page.getByRole('button', { name: '编辑片段', exact: true }).click();
  } else await row(b!).locator('[data-segment-script]').dblclick();
  const input = page.getByLabel(entry === '详情' ? '详情文案' : '文案全文', { exact: true }); await input.fill('B 删除前保存');
  const open = async () => {
    await row(b!).locator('[col-id="order"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '删除本片段', exact: true }).click();
  };
  await open();
  expect((await project.status()).snapshot.segments[1]!.text).toBe('B');
  await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(input).toHaveValue('B 删除前保存');
  await page.route('**/api/segments/edit', route => route.fulfill({ status: 500, json: { error: '先保存失败' } }));
  await open(); await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.locator('footer')).toContainText('先保存失败');
  await expect(input).toHaveValue('B 删除前保存');
  expect((await project.status()).snapshot.segments.map(segment => segment.id)).toEqual([a, b, c]);
  await page.unroute('**/api/segments/edit');
  await open(); await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click();
  await expect(row(b!)).toHaveCount(0);
  expect((await project.status()).snapshot.segments.map(segment => segment.id)).toEqual([a, c]);
  await expect(page.locator('.ag-row[aria-selected="true"]')).toHaveCount(2);
});

test('阅读字符与 Space 不启动编辑或勾选，编辑 Esc 提示、输入法及 Tab 保留草稿', async ({ page, project }) => {
  const [a, b] = await project.seed(['A', 'B']); await page.goto(project.url);
  const cell = page.locator(`[row-id="${a}"] [col-id="text"]`);
  await cell.focus(); await page.keyboard.press('x'); await page.keyboard.press('Space');
  await expect(page.getByLabel('文案全文', { exact: true })).toHaveCount(0);
  await expect(page.locator('.ag-row[aria-selected="true"]')).toHaveCount(0);
  const order = page.locator(`[row-id="${a}"] [col-id="order"]`);
  await order.focus(); await page.keyboard.press('Space');
  await expect(page.locator('.ag-row[aria-selected="true"]')).toHaveCount(0);
  await cell.focus(); await page.keyboard.press('F2');
  const input = page.getByLabel('文案全文', { exact: true }); await expect(input).toBeFocused();
  await input.fill('未保存输入'); await input.press('Tab'); await expect(input).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect((await project.status()).snapshot.segments[0]!.text).toBe('A');
  await input.dispatchEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true });
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await input.press('Escape'); await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(input).toHaveValue('未保存输入'); await expect(input).toBeFocused();
  await input.press('Escape'); await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(input).toHaveCount(0); await expect(cell).toBeFocused();
  const checkbox = page.locator(`[row-id="${b}"] input[type="checkbox"]`);
  await checkbox.focus(); await checkbox.press('Space');
  await expect(checkbox).toBeChecked();
});

for (const selection of [0, 1, 2]) for (const details of [false, true]) for (const entry of ['双击', 'Enter', 'F2']) test(`${selection} 条勾选、详情${details ? '开' : '关'}、${entry}编辑互不干扰`, async ({ page, project }) => {
  const [a, b, c] = await project.seed(['A', 'B', 'C']); await page.goto(project.url);
  if (selection > 0) await page.locator(`[row-id="${a}"] input[type="checkbox"]`).click();
  if (selection > 1) await page.locator(`[row-id="${c}"] input[type="checkbox"]`).click();
  if (details) await page.getByRole('button', { name: '查看片段 1 的详情', exact: true }).click();
  const cell = page.locator(`[row-id="${b}"] [col-id="text"]`);
  if (entry === '双击') await cell.locator('[data-segment-script]').dblclick();
  else { await cell.focus(); await page.keyboard.press(entry); }
  await expect(page.getByLabel('文案全文', { exact: true })).toHaveValue('B');
  await expect(page.getByLabel('文案全文', { exact: true })).toBeFocused();
  await expect(page.getByLabel('口播片段详情', { exact: true })).toHaveCount(0);
  await expect(page.locator('.ag-row[aria-selected="true"]')).toHaveCount(selection);
  if (selection > 0) await expect(page.locator(`[row-id="${a}"] input[type="checkbox"]`)).toBeChecked();
  if (selection > 1) await expect(page.locator(`[row-id="${c}"] input[type="checkbox"]`)).toBeChecked();
});

test('原位断线保留草稿，外部修改拒绝覆盖，删除后仍能复制并主动放弃', async ({ page, project }) => {
  const [a] = await project.seed(['A']); await page.goto(project.url);
  await page.locator(`[row-id="${a}"] [data-segment-script]`).dblclick();
  const input = page.getByLabel('文案全文', { exact: true }); await input.fill('原位断线草稿');
  await project.restart(async () => {
    await expect(page.locator('footer')).toContainText('编辑连接已断开');
    await expect(input).toHaveValue('原位断线草稿');
  });
  const before = (await project.status()).snapshot.segments[0]!;
  await project.modify({ changes: [{ kind: 'edit', expected: before, text: '外部新文字' }] });
  await input.press('Control+Enter');
  await expect(page.locator('footer')).toContainText('不能覆盖新内容');
  await expect(input).toHaveValue('原位断线草稿');
  const current = (await project.status()).snapshot.segments[0]!;
  await project.modify({ changes: [{ kind: 'delete', expected: current }] });
  await expect(page.getByLabel('已删除片段的草稿')).toBeVisible();
  await expect(input).toHaveValue('原位断线草稿'); await expect(input).toHaveAttribute('readonly', '');
  await page.getByRole('button', { name: '放弃草稿', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(input).toHaveCount(0);
});

test('多选保留时对未勾选的草稿片段相对插入，保存后的锚点不会误报冲突', async ({ page, project }) => {
  const [a, b, c] = await project.seed(['A', 'B', 'C']); await page.goto(project.url);
  for (const id of [a, c]) await page.locator(`[row-id="${id}"] input[type="checkbox"]`).click();
  await page.locator(`[row-id="${b}"] [data-segment-script]`).dblclick();
  await page.getByLabel('文案全文', { exact: true }).fill('B 插入前保存');
  await page.locator(`[row-id="${b}"] [col-id="order"]`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '下方添加', exact: true }).click();
  await expect(page.getByLabel('文案全文', { exact: true })).toHaveValue('');
  expect((await project.status()).snapshot.segments.map(segment => segment.text)).toEqual(['A', 'B 插入前保存', '', 'C']);
  await expect(page.locator('.ag-row[aria-selected="true"]')).toHaveCount(2);
});

for (const fail of [false, true]) test(`拖动期间保留草稿，取消不保存，有效落点${fail ? '保存失败阻止重排' : '保存后重排'}`, async ({ page, project }) => {
  const [a, b, c] = await project.seed(['A', 'B', 'C']); await page.goto(project.url);
  await page.locator(`[row-id="${a}"] input[type="checkbox"]`).click();
  await page.locator(`[row-id="${b}"] [data-segment-script]`).dblclick();
  const input = page.getByLabel('文案全文', { exact: true }); await input.fill('B 拖动草稿');
  const begin = async () => {
    const handle = page.getByRole('button', { name: '拖动片段 2', exact: true }); await handle.hover();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + 12, box.y + 12); await page.mouse.down();
  };
  const move = async () => {
    const box = (await page.locator(`[row-id="${c}"] [col-id="order"]`).boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + box.height - 10, { steps: 5 });
    await expect(page.getByText('移动 1 条', { exact: true })).toBeVisible();
  };
  await begin(); await page.mouse.up();
  expect((await project.status()).snapshot.segments[1]!.text).toBe('B');
  await begin(); await move();
  expect((await project.status()).snapshot.segments[1]!.text).toBe('B');
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(input).toHaveValue('B 拖动草稿');
  if (fail) await page.route('**/api/segments/edit', route => route.fulfill({ status: 500, json: { error: '拖动前保存失败' } }));
  await begin(); await move(); await page.mouse.up();
  if (fail) {
    await expect(page.locator('footer')).toContainText('拖动前保存失败');
    await expect(input).toHaveValue('B 拖动草稿');
    expect((await project.status()).snapshot.segments.map(segment => segment.id)).toEqual([a, b, c]);
  } else {
    await expect.poll(async () => (await project.status()).snapshot.segments.map(segment => segment.id)).toEqual([a, c, b]);
    expect((await project.status()).snapshot.segments[2]!.text).toBe('B 拖动草稿');
  }
  await expect(page.locator(`[row-id="${a}"] input[type="checkbox"]`)).toBeChecked();
  await expect(page.locator('.ag-row[aria-selected="true"]')).toHaveCount(1);
});

for (const action of ['Esc', '查看', '新增'] as const) test(`旧${action}等待修改权释放时离页，新草稿不被迟到继续清除`, async ({ page, project }) => {
  const [a, b] = await project.seed(['A', 'B']); await page.goto(project.url);
  await page.locator(`[row-id="${a}"] [data-segment-script]`).dblclick();
  const input = page.getByLabel('文案全文', { exact: true }); await expect(input).toBeFocused();
  const gate = await holdResponse(page, '/api/edit-session/release');
  try {
    if (action === 'Esc') await input.press('Escape');
    else if (action === '查看') await page.getByRole('button', { name: '查看片段 1 的详情', exact: true }).click();
    else await page.getByRole('button', { name: '新增口播片段', exact: true }).click();
    await gate.received;
    await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('pageshow')); });
    await expect.poll(async () => (await project.status()).modification).toBeNull();
    await page.locator(`[row-id="${b}"] [data-segment-script]`).dblclick();
    await input.fill('新过程的 B 草稿');
  } finally { gate.release(); }
  await gate.delivered;
  await expect(input).toHaveValue('新过程的 B 草稿');
  await expect(page.locator('[data-save-status]')).toHaveText('未保存');
  await expect(page.getByLabel('口播片段详情', { exact: true })).toHaveCount(0);
  expect((await project.status()).snapshot.segments.map(segment => segment.text)).toEqual(['A', 'B']);
});
