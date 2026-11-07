import { selectTestStyle } from './helpers/project-style.js';
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


test('面板显示项目风格，未设置时显示原因并禁用全片导出', async ({ page, project }) => {
  await page.goto(project.url);
  await expect(page.getByLabel('项目风格')).toHaveText('未设置项目风格，无法导出');
  const exportButton = page.getByRole('button', { name: '导出全片', exact: true });
  await expect(exportButton).toBeDisabled();
  await selectTestStyle(project.url);
  await expect(page.getByLabel('项目风格')).toHaveText('项目风格 test-color · 1');
  await expect(exportButton).toBeEnabled();
  await page.setViewportSize({ width: 420, height: 360 });
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '更多操作' })).toContainText('项目风格 test-color · 1');
});
