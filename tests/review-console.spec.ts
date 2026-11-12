import { basename } from 'node:path';
import { test, expect } from './helpers/project.js';
import { selectTestStyle } from './helpers/project-style.js';
import { panelTheme } from './helpers/theme-contract.js';

test('项目与风格常驻，空闲时页脚只显示任务详情，更多操作无重复入口', async ({ page, project }) => {
  await page.setViewportSize({ width: 420, height: 800 });
  await project.seed(['审阅第一句']);
  await page.goto(project.url);
  const header = page.locator('header');
  const projectName = basename(project.directory);
  await expect(header.getByRole('heading')).toHaveText(projectName);
  const warning = header.getByText('未设置项目风格，暂不能导出', { exact: true });
  await expect(warning).toHaveCSS('color', panelTheme.color.warning);
  await expect(warning).toHaveCSS('background-color', panelTheme.color.warningSurface);
  await expect(header.getByRole('button', { name: '导出全片' })).toBeDisabled();
  const footer = page.locator('footer');
  await expect(footer).toHaveText('任务详情');
  await page.getByRole('row').last().getByRole('checkbox').check();
  await expect(footer).toContainText('已勾选 1 条');
  await expect(footer.getByRole('button', { name: '删除已勾选' })).toBeVisible();
  await footer.getByRole('button', { name: '清空勾选' }).click();
  await expect(footer).toHaveText('任务详情');
  await expect(page.getByText('画面说明')).toHaveCount(0);

  await selectTestStyle(project.url);
  const style = (await project.status()).snapshot.projectStyle!;
  await expect(header.getByRole('heading')).toHaveText(`${projectName} · ${style.id}`);
  await expect(header.getByRole('button', { name: '导出全片' })).toBeEnabled();
  await header.getByRole('button', { name: '查找' }).click();
  await header.getByRole('button', { name: '更多' }).click();
  const more = page.getByRole('dialog', { name: '更多操作' });
  await expect(more.getByRole('button')).toHaveText(['粘贴多行文案', '声音设置', '导出设置', '任务记录', '关闭']);
  await expect(page.getByRole('button', { name: /新增口播片段/, includeHidden: true })).toHaveCount(1);
});
