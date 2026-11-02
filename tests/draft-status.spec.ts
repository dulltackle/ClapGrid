import { test, expect } from './helpers/project.js';
import { holdResponse } from './helpers/response-gate.js';

for (const width of [1600, 420]) for (const entry of ['原位', '详情'] as const) test(`${entry}草稿页脚区分失败后的修改并可回到草稿 ${width}`, async ({ page, project }, testInfo) => {
  await page.setViewportSize({ width, height: 800 });
  const [id] = await project.seed(['原文']);
  await page.goto(project.url);
  if (entry === '原位') await page.locator(`[row-id="${id}"] [data-segment-script]`).dblclick();
  else {
    await page.getByRole('button', { name: '查看片段 1 的详情', exact: true }).click();
    await page.getByLabel('详情文案', { exact: true }).dblclick();
  }
  const input = page.getByLabel(entry === '原位' ? '文案全文' : '详情文案', { exact: true });
  const footer = page.getByLabel('项目状态', { exact: true });
  const state = footer.locator('[data-save-status]');
  await expect(state).toHaveText('已保存');
  await input.fill('第一版草稿');
  await expect(state).toHaveText('未保存');
  await page.route('**/api/segments/edit', route => route.fulfill({ status: 500, json: { error: '保存服务故障' } }));
  await input.press('Control+Enter');
  await expect(state).toHaveText('保存失败');
  await expect(page.getByLabel('操作异常', { exact: true })).toContainText('保存服务故障');
  await input.fill('第二版草稿');
  await expect(state).toHaveText('保存失败 · 未保存');
  await footer.getByRole('button', { name: '回到草稿', exact: true }).click();
  await expect(input).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('draft-status.png') });
  await expect(footer.getByRole('button', { name: /保存修改|放弃修改|重试/ })).toHaveCount(0);
  await input.fill('原文');
  await expect(state).toHaveText('已保存');
  await expect(page.getByLabel('操作异常', { exact: true })).toHaveCount(0);
  await input.fill('第二版草稿');
  await expect(state).toHaveText('未保存');
  await page.unroute('**/api/segments/edit');
  const gate = await holdResponse(page, '/api/segments/edit');
  try {
    await input.press('Control+Enter'); await gate.received;
    await expect(state).toHaveText('保存中…');
  } finally { gate.release(); }
  await gate.delivered;
  await expect(state).toHaveText('已保存');
  await expect(footer.getByRole('button', { name: '回到草稿', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('操作异常', { exact: true })).toHaveCount(0);
});

for (const width of [1600, 420]) for (const entry of ['原位', '详情'] as const) {
  for (const scenario of ['断线', '外部冲突', '目标被删除'] as const) test(`${entry}草稿共用场景：${scenario} ${width}`, async ({ page, project }) => {
    await page.setViewportSize({ width, height: width === 420 ? 360 : 1000 });
    const [id] = await project.seed(['原文']); await page.goto(project.url);
    if (entry === '原位') await page.locator(`[row-id="${id}"] [data-segment-script]`).dblclick();
    else {
      await page.getByRole('button', { name: '查看片段 1 的详情', exact: true }).click();
      await page.getByRole('button', { name: '编辑片段', exact: true }).click();
    }
    const input = page.getByLabel(entry === '原位' ? '文案全文' : '详情文案', { exact: true });
    await input.fill('保留的草稿');
    await project.restart(async () => {
      await expect(page.getByLabel('操作异常', { exact: true })).toContainText('编辑连接已断开');
      await expect(input).toHaveValue('保留的草稿');
    });
    if (scenario === '断线') {
      await input.press('Control+Enter');
      await expect(page.locator('[data-save-status]')).toHaveText('已保存');
      expect((await project.status()).snapshot.segments[0]!.text).toBe('保留的草稿');
      return;
    }
    const before = (await project.status()).snapshot.segments[0]!;
    if (scenario === '外部冲突') {
      await project.modify({ changes: [{ kind: 'edit', expected: before, text: '外部新文案' }] });
      await input.press('Control+Enter');
      await expect(page.getByLabel('操作异常', { exact: true })).toContainText('不能覆盖新内容');
      await expect(input).toHaveValue('保留的草稿');
      expect((await project.status()).snapshot.segments[0]!.text).toBe('外部新文案');
    } else {
      await project.modify({ changes: [{ kind: 'delete', expected: before }] });
      await expect(page.locator('[data-save-status]')).toHaveText('无法保存 · 片段已删除');
      const copy = page.getByLabel('已删除片段的文案草稿', { exact: true });
      await page.getByRole('button', { name: '回到草稿', exact: true }).click();
      await expect(copy).toBeFocused(); await expect(copy).toHaveValue('保留的草稿');
      await expect(copy).toHaveAttribute('readonly', ''); await expect(copy).toBeEnabled();
      const footer = page.getByLabel('项目状态', { exact: true });
      for (const button of ['回到草稿', '任务详情']) {
        const bounds = (await footer.getByRole('button', { name: button, exact: true }).boundingBox())!;
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(width === 420 ? 360 : 1000);
      }
      expect(await footer.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.getByRole('button', { name: '放弃草稿', exact: true }).click();
      await page.getByRole('button', { name: '放弃修改', exact: true }).click();
      await expect(page.getByLabel('已删除片段的草稿', { exact: true })).toHaveCount(0);
      await expect(page.locator('[data-save-status]')).toHaveText('已保存');
    }
  });
}

test('原位草稿滚出虚拟表格后回到草稿并保留内容', async ({ page, project }) => {
  const [id] = await project.seed(Array.from({ length: 100 }, (_, index) => `片段 ${index}`));
  await page.goto(project.url);
  await page.locator(`[row-id="${id}"] [data-segment-script]`).dblclick();
  const input = page.getByLabel('文案全文', { exact: true });
  await input.fill('滚动前的草稿');
  await page.locator('.ag-grid-viewport').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(input).not.toBeInViewport();
  await page.getByRole('button', { name: '回到草稿', exact: true }).click();
  await expect(input).toBeInViewport(); await expect(input).toBeFocused();
  await expect(input).toHaveValue('滚动前的草稿');
});
