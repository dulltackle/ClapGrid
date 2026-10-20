import { test, expect } from './helpers/project.js';
import { holdResponse } from './helpers/response-gate.js';

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

test('字号草稿Escape保留面板，边界保存失败不覆盖已保存设置', async ({ page, project }) => {
  await page.goto(project.url); await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '导出设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '全片导出设置', exact: true });
  await page.getByRole('button', { name: '编辑设置', exact: true }).click();
  const size = page.getByLabel('字幕字号（px）', { exact: true });
  await size.fill('48'); await size.press('Escape');
  await expect(dialog).toContainText('字号尚未保存'); await expect(size).toHaveValue('48');
  await size.press('Enter'); await expect(dialog.getByRole('status')).toHaveText('已保存');
  expect((await project.status()).snapshot.exportSettings.fontSize).toBe(48);
  for (const value of ['1080', '1', '']) {
    await size.fill(value); await size.press('Enter');
    await expect(dialog.getByRole('status')).toHaveText('已保存');
    expect((await project.status()).snapshot.exportSettings.fontSize).toBe(value ? Number(value) : null);
  }
  for (const value of ['0', '1081', '1.5']) {
    await size.fill(value); await size.press('Enter');
    await expect(dialog.getByRole('status')).toContainText('保存失败');
    expect((await project.status()).snapshot.exportSettings.fontSize).toBeNull();
  }
});

test('设置保存中禁止关闭，失败保留旧值，真实断线取消未提交字号', async ({ page, project }) => {
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
  expect((await project.status()).snapshot.exportSettings).toMatchObject({ fps: 25, fontSize: null });
  // 在线关闭的焦点返回与实际断线重挂载是不同旅程，分别核对。
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '更多', exact: true })).toBeFocused();
  await expect.poll(async () => (await project.status()).modification).toBeNull();
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '导出设置', exact: true }).click();
  await page.getByRole('button', { name: '编辑设置', exact: true }).click();
  const size = page.getByLabel('字幕字号（px）', { exact: true }); await size.fill('77');
  await expect(size).toHaveValue('77');
  await project.restart(async () => {
    await expect(page.locator('[aria-label="操作异常"]')).toContainText('未提交输入已取消');
    await expect(page.locator('footer')).toContainText('服务连接失败');
    // status 不可用会卸载设置模态；旧实例的消息不应当作重连后新实例的持久状态。
    await expect(dialog).toHaveCount(0);
  });
  await expect(dialog.getByRole('status')).toHaveText('设置按项目自动保存');
  await expect(size).toBeDisabled(); await expect(size).toHaveValue('');
  const restored = await project.status();
  expect(restored.snapshot.exportSettings).toMatchObject({ fps: 25, fontSize: null });
  expect(restored.modification).toBeNull();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await project.status()).modification).toBeNull();
});

test('设置加载失败保留说明与禁用字体，窄矮视口控件可滚动到达', async ({ page, project }) => {
  await page.setViewportSize({ width: 420, height: 360 });
  await page.route('**/api/export-settings', route => route.fulfill({ status: 500, json: { error: '媒体检查失败' } }));
  await page.goto(project.url); await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '导出设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '全片导出设置', exact: true });
  await expect(dialog.getByRole('status')).toContainText('读取导出设置失败');
  await page.getByRole('button', { name: '编辑设置', exact: true }).click();
  await expect(page.getByLabel('字幕字体', { exact: true })).toBeDisabled();
  for (const label of ['导出编码', '导出帧率', '字幕字号（px）']) {
    const input = page.getByLabel(label, { exact: true });
    await input.scrollIntoViewIfNeeded(); await expect(input).toBeInViewport();
    await expect(input).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(32);
  }
  const close = page.getByRole('button', { name: '关闭设置', exact: true });
  await close.scrollIntoViewIfNeeded(); await expect(close).toBeInViewport(); await close.click();
  await expect(dialog).toHaveCount(0);
});

test('已选字体在当前枚举不可用时保留原名称而不静默替换', async ({ page, project }) => {
  await page.route('**/api/export-settings', async route => {
    const response = await route.fetch(); const body = await response.json();
    await route.fulfill({ response, json: { ...body, settings: { ...body.settings, fontFamily: '已消失的字体' }, fonts: [] } });
  });
  await page.route('**/api/status', async route => {
    const response = await route.fetch(); const status = await response.json();
    status.snapshot.exportSettings.fontFamily = '已消失的字体'; await route.fulfill({ response, json: status });
  });
  await page.goto(project.url); await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '导出设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '全片导出设置', exact: true }).getByRole('status')).toHaveText('设置按项目自动保存');
  await expect(page.getByLabel('字幕字体', { exact: true }).locator('option:checked')).toHaveText('已消失的字体（当前不可用）');
});
