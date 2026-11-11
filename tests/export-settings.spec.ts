import { selectTestStyle } from './helpers/project-style.js';
import { test, expect } from './helpers/project.js';
import { holdResponse } from './helpers/response-gate.js';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

test('导出设置查看不占修改权，原生选择器自动保存并在重开保留', async ({ page, project }) => {
  await project.seed(['A']); await page.goto(project.url);
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '导出设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '全片导出设置', exact: true });
  await expect(dialog).toContainText('下一次导出采用当前设置');
  expect((await project.status()).modification).toBeNull();
  await expect(page.getByLabel('导出编码', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '编辑设置', exact: true }).click();
  const fps = page.getByLabel('导出帧率', { exact: true });
  await expect(fps).toBeEnabled(); await fps.selectOption('60');
  await expect(dialog.getByRole('status')).toHaveText('已保存');
  await page.getByLabel('导出编码', { exact: true }).selectOption('mpeg4');
  await expect(dialog.getByRole('status')).toHaveText('已保存');
  expect((await project.status()).snapshot.exportSettings).toMatchObject({ fps: 60, codec: 'mpeg4' });
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await expect.poll(async () => (await project.status()).modification).toBeNull();
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '导出设置', exact: true }).click();
  await expect(fps).toHaveValue('60'); await expect(page.getByLabel('导出编码', { exact: true })).toHaveValue('mpeg4');
});

test('面板取得修改权后可选择、替换与移除项目背景乐', async ({ page, project }) => {
  const buffer = readFileSync('tests/fixtures/legacy-visuals/media/86c4315d-612c-4d37-bea5-6be31bde1b5e.mp3');
  await page.setViewportSize({ width: 420, height: 430 });
  await page.goto(project.url);
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '导出设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '全片导出设置', exact: true });
  const input = dialog.getByLabel('选择背景乐文件', { exact: true });
  await expect(input).toBeDisabled();
  await expect(dialog).toContainText('未设置背景乐');
  await dialog.getByRole('button', { name: '编辑设置' }).click();
  await expect(input).toBeEnabled();
  for (const name of ['第一首.mp3', '第二首.mp3']) {
    await input.setInputFiles({ name, mimeType: 'audio/mpeg', buffer });
    await expect(dialog.getByRole('status')).toHaveText('已保存');
    await expect(dialog).toContainText(name);
    expect((await project.status()).snapshot.backgroundMusic?.name).toBe(name);
  }
  await dialog.getByRole('button', { name: '移除背景乐' }).click();
  await expect(dialog).toContainText('未设置背景乐');
  expect((await project.status()).snapshot.backgroundMusic).toBeNull();
});

test('设置保存中禁止关闭，失败保留旧值，真实断线释放修改权', async ({ page, project }) => {
  await page.goto(project.url); await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '导出设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '全片导出设置', exact: true });
  await page.getByRole('button', { name: '编辑设置', exact: true }).click();
  await page.route('**/api/export-settings', async route => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 500, json: { error: '本例设置保存失败' } });
    else await route.continue();
  });
  const fps = page.getByLabel('导出帧率', { exact: true });
  await fps.selectOption('60'); await expect(dialog.getByRole('status')).toContainText('本例设置保存失败');
  await expect(fps).toHaveValue('30');
  await page.unroute('**/api/export-settings');
  const gate = await holdResponse(page, '/api/export-settings');
  try {
    await fps.selectOption('25'); await gate.received;
    await expect(page.getByRole('button', { name: '关闭设置', exact: true })).toBeDisabled();
    await expect(fps).toBeDisabled(); await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  } finally { gate.release(); }
  await gate.delivered; await expect(fps).toHaveValue('25');
  await expect(dialog.getByRole('status')).toHaveText('已保存');
  expect((await project.status()).snapshot.exportSettings).toMatchObject({ fps: 25 });
  // 在线关闭的焦点返回与实际断线重挂载是不同旅程，分别核对。
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '更多', exact: true })).toBeFocused();
  await expect.poll(async () => (await project.status()).modification).toBeNull();
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '导出设置', exact: true }).click();
  await page.getByRole('button', { name: '编辑设置', exact: true }).click();
  await expect(fps).toBeEnabled();
  await project.restart(async () => {
    await expect(page.locator('[aria-label="操作异常"]')).toContainText('未提交输入已取消');
    await expect(page.locator('footer')).toContainText('服务连接失败');
    // status 不可用会卸载设置模态；旧实例的消息不应当作重连后新实例的持久状态。
    await expect(dialog).toHaveCount(0);
  });
  await expect(dialog.getByRole('status')).toHaveText('设置按项目自动保存');
  await expect(fps).toBeDisabled(); await expect(fps).toHaveValue('25');
  const restored = await project.status();
  expect(restored.snapshot.exportSettings).toMatchObject({ fps: 25 });
  expect(restored.modification).toBeNull();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await project.status()).modification).toBeNull();
});

test('设置加载失败保留说明，窄矮视口控件可滚动到达', async ({ page, project }) => {
  await page.setViewportSize({ width: 420, height: 360 });
  await page.route('**/api/export-settings', route => route.fulfill({ status: 500, json: { error: '媒体检查失败' } }));
  await page.goto(project.url); await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '导出设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '全片导出设置', exact: true });
  await expect(dialog.getByRole('status')).toContainText('读取导出设置失败');
  await page.getByRole('button', { name: '编辑设置', exact: true }).click();
  for (const label of ['导出编码', '导出帧率']) {
    const input = page.getByLabel(label, { exact: true });
    await input.scrollIntoViewIfNeeded(); await expect(input).toBeInViewport();
    await expect(input).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(32);
  }
  const close = page.getByRole('button', { name: '关闭设置', exact: true });
  await close.scrollIntoViewIfNeeded(); await expect(close).toBeInViewport(); await close.click();
  await expect(dialog).toHaveCount(0);
});


test('项目风格随项目常驻顶栏，未设置时说明并禁用全片导出', async ({ page, project }) => {
  await page.goto(project.url);
  const header = page.locator('header');
  const title = header.getByRole('heading', { level: 1 });
  await expect(header.getByText('未设置项目风格，暂不能导出', { exact: true })).toBeVisible();
  const exportButton = header.getByRole('button', { name: '导出全片', exact: true });
  await expect(exportButton).toBeDisabled();
  await selectTestStyle(project.url);
  const name = basename(project.directory);
  await expect(title).toHaveText(`${name} · test-color`);
  await expect(exportButton).toBeEnabled();
  await page.setViewportSize({ width: 420, height: 360 });
  await expect(title).toBeInViewport();
  await expect(title).toHaveText(`${name} · test-color`);
});
