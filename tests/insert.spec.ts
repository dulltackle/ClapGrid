import { test, expect } from './helpers/project.js';
import { holdRequest, holdResponse } from './helpers/response-gate.js';

for (const entry of ['顶部', '底部', '更多'] as const) test(`${entry}普通新增清除查找并选中编辑，关闭回新片段`, async ({ page, project }) => {
  await project.seed(['A', 'B']); await page.goto(project.url);
  await page.getByRole('button', { name: '查找', exact: true }).click();
  await page.getByLabel('查找文案', { exact: true }).fill('A');
  if (entry === '更多') {
    await page.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '新增口播片段', exact: true }).click();
  } else await page.getByRole('button', { name: entry === '底部' ? '新增口播片段（表格底部）' : '新增口播片段', exact: true }).click();
  const draft = page.getByLabel('详情文案', { exact: true });
  await expect(draft).toBeEditable(); await expect(draft).toBeFocused();
  await expect(page.getByLabel('查找文案', { exact: true })).toHaveCount(0);
  const segments = (await project.status()).snapshot.segments;
  expect(segments.map(segment => segment.text)).toEqual(['A', 'B', '']);
  const id = segments.at(-1)!.id;
  await expect(page.locator(`[row-id="${id}"]`)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator(`[row-id="${id}"] :focus`)).toHaveCount(1);
  await page.keyboard.press('ArrowUp');
  await expect(page.locator(`[row-id="${segments[1]!.id}"] [col-id="text"]`)).toBeFocused();
});

for (const placement of ['上方添加', '下方添加'] as const) test(`相对${placement}经过真实HTTP创建、选择和保存正确位置`, async ({ page, project }) => {
  await page.setViewportSize({ width: 420, height: 800 });
  const [a, b] = await project.seed(['A', 'B']); await page.goto(project.url);
  await page.locator(`[row-id="${a}"] [data-segment-script]`).click({ button: 'right' });
  if (placement === '下方添加') { await page.keyboard.press('End'); await page.keyboard.press('Enter'); }
  else await page.getByRole('menuitem', { name: placement, exact: true }).click();
  const input = page.getByLabel('文案全文', { exact: true });
  await expect(input).toBeFocused(); await expect(input).toBeInViewport();
  await input.fill('插入文案'); await input.press('Control+Enter');
  await expect(page.locator('[data-save-status]')).toHaveText('已保存');
  const segments = (await project.status()).snapshot.segments;
  expect(segments.map(segment => segment.text)).toEqual(placement === '上方添加' ? ['插入文案', 'A', 'B'] : ['A', '插入文案', 'B']);
  expect(segments.filter(segment => segment.id === a || segment.id === b)).toHaveLength(2);
  const created = segments.find(segment => segment.id !== a && segment.id !== b)!;
  await expect(page.locator(`[row-id="${created.id}"]`)).toHaveAttribute('aria-selected', 'true');
});

for (const kind of ['普通', '相对'] as const) test(`${kind}新增迟到成功保留用户查找、勾选与焦点`, async ({ page, project }) => {
  const [a] = await project.seed(['A', 'B']); await page.goto(project.url);
  await page.locator(`[row-id="${a}"] input[type="checkbox"]`).click();
  const gate = await holdResponse(page, '/api/segments/modify');
  try {
    if (kind === '普通') await page.getByRole('button', { name: '新增口播片段', exact: true }).click();
    else {
      await page.locator(`[row-id="${a}"] [data-segment-script]`).click({ button: 'right' });
      await page.getByRole('menuitem', { name: '下方添加', exact: true }).click();
    }
    await gate.received;
    await page.getByRole('button', { name: '查找', exact: true }).click();
    await page.getByLabel('查找文案', { exact: true }).fill('B');
  } finally { gate.release(); }
  await gate.delivered;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await expect(page.locator('[data-save-status]')).toHaveText('已保存');
  await expect(page.getByLabel('查找文案', { exact: true })).toBeFocused();
  await expect(page.getByLabel('查找文案', { exact: true })).toHaveValue('B');
  await expect(page.locator(`[row-id="${a}"]`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('文案全文', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('详情文案', { exact: true })).toHaveCount(0);
  expect((await project.status()).snapshot.segments).toHaveLength(3); expect(gate.calls).toBe(1);
});

for (const kind of ['普通', '相对'] as const) test(`${kind}新增第二次修改权迟到不抢新键盘焦点且释放租约`, async ({ page, project }) => {
  const [a] = await project.seed(['A', 'B']); await page.goto(project.url);
  const gate = await holdRequest(page, '/api/edit-session', 2);
  try {
    if (kind === '普通') await page.getByRole('button', { name: '新增口播片段', exact: true }).click();
    else {
      await page.locator(`[row-id="${a}"] [data-segment-script]`).click({ button: 'right' });
      await page.getByRole('menuitem', { name: '下方添加', exact: true }).click();
    }
    await gate.received;
    await page.getByRole('button', { name: '查找', exact: true }).click();
    await page.getByLabel('查找文案', { exact: true }).pressSequentially('B');
  } finally { gate.release(); }
  await gate.answered;
  await expect.poll(async () => (await project.status()).modification).toBeNull();
  await expect(page.getByLabel('查找文案', { exact: true })).toBeFocused();
  await expect(page.getByLabel('查找文案', { exact: true })).toHaveValue('B');
  await expect(page.getByLabel('文案全文', { exact: true })).toHaveCount(0);
  if (kind === '普通') await expect(page.getByLabel('详情文案', { exact: true })).toHaveAttribute('readonly', '');
  expect((await project.status()).snapshot.segments).toHaveLength(3);
});

test('新增响应后释放修改权等待期间的新操作取消详情导航', async ({ page, project }) => {
  await project.seed(['A']); await page.goto(project.url);
  const gate = await holdResponse(page, '/api/edit-session/release');
  try {
    await page.getByRole('button', { name: '新增口播片段', exact: true }).click(); await gate.received;
    expect((await project.status()).snapshot.segments).toHaveLength(2);
    await page.getByRole('button', { name: '查找', exact: true }).click();
    await page.getByLabel('查找文案', { exact: true }).fill('A');
  } finally { gate.release(); }
  await gate.delivered;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await expect(page.getByLabel('查找文案', { exact: true })).toBeFocused();
  await expect(page.getByLabel('详情文案', { exact: true })).toHaveCount(0);
});

for (const kind of ['普通', '相对'] as const) test(`${kind}新增明确失败保留新查找且不制造片段`, async ({ page, project }) => {
  const [a] = await project.seed(['A']); await page.goto(project.url);
  let fail!: () => void; let received!: () => void;
  const ready = new Promise<void>(resolve => { received = resolve; });
  const released = new Promise<void>(resolve => { fail = resolve; });
  let calls = 0;
  await page.route('**/api/segments/modify', async route => { calls++; received(); await released; await route.fulfill({ status: 500, json: { error: '本例新增失败' } }); });
  try {
    if (kind === '普通') await page.getByRole('button', { name: '新增口播片段', exact: true }).click();
    else {
      await page.locator(`[row-id="${a}"] [data-segment-script]`).click({ button: 'right' });
      await page.getByRole('menuitem', { name: '上方添加', exact: true }).click();
    }
    await ready; await page.getByRole('button', { name: '查找', exact: true }).click();
    await page.getByLabel('查找文案', { exact: true }).fill('A');
  } finally { fail(); }
  await expect(page.locator('[data-save-status]')).toHaveText('保存失败');
  await expect(page.getByLabel('查找文案', { exact: true })).toBeFocused();
  await expect(page.getByLabel('查找文案', { exact: true })).toHaveValue('A');
  expect((await project.status()).snapshot.segments.map(segment => segment.text)).toEqual(['A']);
  await expect.poll(async () => (await project.status()).modification).toBeNull();
  expect(calls).toBe(1);
});

test('相对插入保留菜单打开时锚点，外部修改冲突不误插入', async ({ page, project }) => {
  const [a] = await project.seed(['A', 'B']); await page.goto(project.url);
  await page.locator(`[row-id="${a}"] [data-segment-script]`).click({ button: 'right' });
  const first = (await project.status()).snapshot.segments[0]!;
  await project.modify({ changes: [{ kind: 'edit', expected: first, text: '外部改变 A' }] });
  await page.getByRole('menuitem', { name: '上方添加', exact: true }).click();
  await expect(page.locator('[data-save-status]')).toHaveText('保存失败');
  expect((await project.status()).snapshot.segments.map(segment => segment.text)).toEqual(['外部改变 A', 'B']);
  await expect(page.locator(`[row-id="${a}"] [col-id="text"]`)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[row-index="1"] [col-id="text"]')).toBeFocused();
});

import { beginEdit } from '../src/shared/client.js';

test('外部修改权占用禁用新增及粘贴，释放后恢复', async ({ page, project }) => {
  await project.seed(['A']); await page.goto(project.url);
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '粘贴多行文案', exact: true }).click();
  await page.getByLabel('多行文案', { exact: true }).fill('B');
  const edit = await beginEdit(project.url);
  try {
    await expect(page.getByRole('button', { name: '新增口播片段', exact: true, includeHidden: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '按非空行新增', exact: true })).toBeDisabled();
  } finally { await edit.close(); }
  await expect(page.getByRole('button', { name: '按非空行新增', exact: true })).toBeEnabled();
});

test('已提交但响应未知的新增不自动重试，真实数据仍只有一次', async ({ page, project }) => {
  await project.seed(['A']); await page.goto(project.url);
  let calls = 0;
  await page.route('**/api/segments/modify', async route => { calls++; await route.fetch(); await route.abort('failed'); });
  await page.getByRole('button', { name: '新增口播片段', exact: true }).click();
  await expect(page.locator('[data-save-status]')).toHaveText('保存失败');
  await expect.poll(async () => (await project.status()).modification).toBeNull();
  expect((await project.status()).snapshot.segments.map(segment => segment.text)).toEqual(['A', '']);
  await expect(page.getByLabel('详情文案', { exact: true })).toHaveCount(0);
  expect(calls).toBe(1);
});

for (const outcome of ['成功', '失败'] as const) test(`离页后旧新增${outcome}不覆盖新的详情、租约与保存状态`, async ({ page, project }) => {
  await project.seed(['A']); await page.goto(project.url);
  let release!: () => void; let arrived!: () => void; let calls = 0; let finish!: () => void;
  const completed = new Promise<void>(resolve => { finish = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const received = new Promise<void>(resolve => { arrived = resolve; });
  await page.route('**/api/segments/modify', async route => {
    if (++calls > 1) { await route.continue(); return; }
    const response = outcome === '成功' ? await route.fetch() : undefined;
    arrived(); await waiting;
    if (response) await route.fulfill({ response });
    else await route.fulfill({ status: 500, json: { error: '失效旧新增失败' } });
    finish();
  });
  try {
    await page.getByRole('button', { name: '新增口播片段', exact: true }).click(); await received;
    // 针对产品生命周期接线的事件测试；真实关闭释放另由 editing.spec 验证。
    await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('pageshow')); });
    await expect.poll(async () => (await project.status()).modification).toBeNull();
    await page.getByRole('button', { name: '新增口播片段', exact: true }).click();
    await expect(page.getByLabel('详情文案', { exact: true })).toBeEditable();
    await expect(page.getByLabel('详情文案', { exact: true })).toBeFocused();
  } finally { release(); }
  await completed;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await expect(page.locator('[data-save-status]')).toHaveText('已保存');
  await expect(page.getByLabel('详情文案', { exact: true })).toBeFocused();
  expect((await project.status()).modification?.owner).toBe('user');
  expect((await project.status()).snapshot.segments).toHaveLength(outcome === '成功' ? 3 : 2);
  await expect(page.getByText('失效旧新增失败', { exact: false })).toHaveCount(0);
});

test('新增第二次修改权等待期间真实滚轮取消旧定位和编辑', async ({ page, project }) => {
  await project.seed(Array.from({ length: 80 }, (_, index) => `片段 ${index + 1}`));
  await page.goto(project.url);
  const gate = await holdRequest(page, '/api/edit-session', 2);
  const scroll = page.locator('.ag-body-vertical-scroll-viewport');
  let afterWheel = 0;
  try {
    await page.getByRole('button', { name: '新增口播片段', exact: true }).click(); await gate.received;
    const positioned = await scroll.evaluate(element => element.scrollTop);
    expect(positioned).toBeGreaterThan(1000);
    await page.mouse.move(200, 250); await page.mouse.wheel(0, -600);
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeLessThan(positioned);
    afterWheel = await scroll.evaluate(element => element.scrollTop);
  } finally { gate.release(); }
  await gate.answered;
  await expect.poll(async () => (await project.status()).modification).toBeNull();
  expect(await scroll.evaluate(element => element.scrollTop)).toBe(afterWheel);
  await expect(page.getByLabel('详情文案', { exact: true })).toHaveAttribute('readonly', '');
});
