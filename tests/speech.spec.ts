import { randomUUID } from 'node:crypto';
import { test, expect } from './helpers/media-project.js';
import { holdResponse } from './helpers/response-gate.js';
import { beginEdit, querySpeech, submitSpeech, submitSpeechBatch } from '../src/shared/client.js';

for (const viewport of [{ width: 1600, height: 1000 }, { width: 420, height: 360 }]) test(`声音设置原生键盘、失败恢复和提交互斥 ${viewport.width}`, async ({ page, project }) => {
  await page.setViewportSize(viewport); await page.goto(project.url);
  await page.getByRole('button', { name: '更多', exact: true }).click(); await page.getByRole('button', { name: '声音设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '统一声音设置', exact: true });
  await expect(dialog).toBeFocused(); await expect(dialog).toContainText('已配置不代表服务已验证');
  const speaker = page.getByLabel('统一音色', { exact: true }); const rate = page.getByLabel('统一语速', { exact: true });
  await expect(speaker.locator('option')).toHaveCount(3); await expect(rate.locator('option')).toHaveCount(151);
  await speaker.focus(); await speaker.press('ArrowDown');
  await expect(speaker).toHaveValue('zh_female_santongyongns_saturn_bigtts');
  await expect.poll(async () => (await querySpeech(project.url)).voice.speaker).toBe('zh_female_santongyongns_saturn_bigtts');
  await page.route('**/api/speech/voice', route => route.fulfill({ status: 500, json: { error: '本例声音保存失败' } }));
  await rate.selectOption('20'); await expect(dialog.getByRole('alert')).toContainText('本例声音保存失败'); await expect(rate).toHaveValue('0');
  await page.unroute('**/api/speech/voice');
  const gate = await holdResponse(page, '/api/speech/voice');
  try {
    await rate.selectOption('20'); await gate.received;
    await expect(rate).toBeDisabled(); await expect(speaker).toBeDisabled();
    await expect(page.getByRole('button', { name: '关闭声音设置', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  } finally { gate.release(); }
  await gate.delivered; await expect(rate).toHaveValue('20');
  const close = page.getByRole('button', { name: '关闭声音设置', exact: true }); await close.scrollIntoViewIfNeeded(); await expect(close).toBeInViewport();
  await close.click(); await expect(page.getByRole('button', { name: '更多', exact: true })).toBeFocused();
});

test('声音加载期间入口禁用，外部修改权动态禁用仍可退出', async ({ page, project }) => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/speech', async route => { await ready; await route.continue(); });
  try {
    await page.goto(project.url);
    await page.getByRole('button', { name: '更多', exact: true }).click();
    await expect(page.getByRole('button', { name: '声音设置', exact: true })).toBeDisabled();
  } finally { release(); }
  await page.getByRole('button', { name: '声音设置', exact: true }).click();
  const edit = await beginEdit(project.url);
  try {
    await page.getByLabel('统一音色', { exact: true }).focus();
    await expect(page.getByLabel('统一音色', { exact: true })).toBeDisabled();
    await expect(page.getByRole('dialog', { name: '统一声音设置', exact: true })).toBeFocused();
    await expect(page.getByRole('button', { name: '关闭声音设置', exact: true })).toBeEnabled();
  } finally { await edit.close(); }
});

for (const viewport of [{ width: 1600, height: 1000 }, { width: 360, height: 320 }]) test(`真实配音试听与原生音频controls焦点范围 ${viewport.width}`, async ({ page, project, speechControl }) => {
  await page.setViewportSize(viewport);
  const [id] = await project.seed(['完整的配音文案\n第二行']);
  await submitSpeech(project.url, { requestId: randomUUID(), segmentId: id! });
  await expect.poll(async () => (await querySpeech(project.url)).audio.length).toBe(1);
  await page.goto(project.url);
  const row = page.locator(`[row-id="${id}"]`);
  await row.getByRole('button', { name: '试听', exact: true }).click();
  const player = page.locator('main > audio');
  await expect.poll(() => player.evaluate(node => !(node as HTMLAudioElement).paused && (node as HTMLAudioElement).readyState >= 1)).toBe(true);
  expect(await player.evaluate(node => (node as HTMLAudioElement).duration)).toBeGreaterThan(1.9);
  await row.getByRole('button', { name: '暂停试听', exact: true }).click();
  expect(await player.evaluate(node => (node as HTMLAudioElement).paused)).toBe(true);
  await row.getByRole('button', { name: '试听', exact: true }).click();
  await page.getByRole('button', { name: '片段 1 配音更多操作', exact: true }).press('Enter');
  await page.getByRole('menuitem', { name: '保留音频与任务记录', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '配音详情与保留音频', exact: true });
  await expect(dialog).toContainText('完整的配音文案');
  const audio = dialog.locator('audio'); await audio.focus(); await page.keyboard.press('Space');
  await expect.poll(() => audio.evaluate(node => !(node as HTMLAudioElement).paused)).toBe(true);
  await expect.poll(() => player.evaluate(node => (node as HTMLAudioElement).paused)).toBe(true);
  await audio.focus(); await page.keyboard.press('ArrowDown');
  expect(await audio.evaluate(node => (node as HTMLAudioElement).volume)).toBeLessThan(1);
  for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key); expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  }
  const close = dialog.getByRole('button', { name: '关闭', exact: true });
  await close.scrollIntoViewIfNeeded(); await expect(close).toBeInViewport(); await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0); expect(speechControl.requests).toHaveLength(1);
  expect((await project.status()).modification).toBeNull();
});

test('有效配音与最新失败独立显示，待更新和完整历史保持新到旧顺序', async ({ page, project, speechControl }) => {
  const [id] = await project.seed(['旧文案']);
  await submitSpeech(project.url, { requestId: randomUUID(), segmentId: id! });
  await expect.poll(async () => (await querySpeech(project.url)).audio.length).toBe(1);
  let segment = (await project.status()).snapshot.segments[0]!;
  await project.modify({ changes: [{ kind: 'edit', expected: segment, text: '当前长文案\n' + '完整'.repeat(100) }] });
  await submitSpeech(project.url, { requestId: randomUUID(), segmentId: id! });
  await expect.poll(async () => (await querySpeech(project.url)).audio.length).toBe(2);
  speechControl.mode = 'failure'; await submitSpeech(project.url, { requestId: randomUUID(), segmentId: id! });
  await expect.poll(async () => (await querySpeech(project.url)).tasks.at(-1)!.state).toBe('failed');
  await page.goto(project.url); const row = page.locator(`[row-id="${id}"]`);
  await expect(row).toContainText('有效配音'); await expect(row).toContainText('生成失败');
  await page.getByRole('button', { name: '片段 1 配音更多操作', exact: true }).press('Enter');
  await page.getByRole('menuitem', { name: '保留音频与任务记录', exact: true }).click();
  const history = page.getByRole('dialog', { name: '配音详情与保留音频', exact: true });
  await expect(history.locator('li').first()).toContainText('当前长文案');
  await expect(history.locator('li').last()).toContainText('旧文案');
  await expect(history).toContainText('配音待更新'); await expect(history).toContainText('鉴权失败');
  await page.keyboard.press('Escape');
  segment = (await project.status()).snapshot.segments[0]!;
  await project.modify({ changes: [{ kind: 'edit', expected: segment, text: '再次改文案' }] });
  await expect(row).toContainText('配音待更新');
});

test('未知提交复用原请求标识且不重复付费', async ({ page, project, speechControl }) => {
  const [id] = await project.seed(['A']); await page.goto(project.url);
  const ids: string[] = []; let calls = 0;
  await page.route('**/api/speech/submit', async route => {
    ids.push((route.request().postDataJSON() as { requestId: string }).requestId);
    if (++calls === 1) { await route.fetch(); await route.abort('failed'); } else await route.continue();
  });
  await page.locator(`[row-id="${id}"]`).getByRole('button', { name: '生成配音', exact: true }).click();
  await expect(page.getByLabel('操作异常', { exact: true })).toContainText('提交未确认');
  await expect.poll(async () => (await querySpeech(project.url)).locked).toBe(false);
  await page.getByRole('button', { name: '片段 1 配音更多操作', exact: true }).press('Enter');
  await page.locator('[data-speech-generate]').click();
  await expect.poll(() => ids.length).toBe(2); expect(ids[0]).toBe(ids[1]);
  expect(speechControl.requests).toHaveLength(1);
});

test('批量配音进度与失败请求在查找未匹配片段时仍可访问', async ({ page, project, speechControl }) => {
  await project.seed(['A', 'B']); speechControl.mode = 'pending';
  const batch = await submitSpeechBatch(project.url, { requestId: randomUUID(), mode: 'generate', scope: { kind: 'all' } });
  await page.goto(project.url); await page.getByRole('button', { name: '查找', exact: true }).click();
  await page.getByLabel('查找文案', { exact: true }).fill('未匹配');
  await expect(page.locator('footer')).toContainText('配音 0/2');
  await expect(page.getByRole('button', { name: '新增口播片段', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '导出全片', exact: true }).click();
  await expect(page.locator('footer')).toContainText('配音');
  await page.getByRole('button', { name: '更多', exact: true }).click(); await page.getByRole('button', { name: '任务记录', exact: true }).click();
  const tasks = page.getByRole('dialog', { name: '任务记录', exact: true });
  await expect(tasks).toContainText(batch.request.requestId);
  speechControl.mode = 'failure'; speechControl.release();
  await expect.poll(async () => (await querySpeech(project.url)).locked).toBe(false);
  await expect(tasks).toContainText('失败 1'); await expect(tasks).toContainText('鉴权失败');
});

test('配音生成期间重复入口禁用而已有音频仍可试听', async ({ page, project, speechControl }) => {
  const [id] = await project.seed(['A']); await submitSpeech(project.url, { requestId: randomUUID(), segmentId: id! });
  await expect.poll(async () => (await querySpeech(project.url)).locked).toBe(false);
  speechControl.mode = 'pending'; await page.goto(project.url);
  await page.getByRole('button', { name: '片段 1 配音更多操作', exact: true }).press('Enter');
  await page.locator('[data-speech-generate]').click();
  await expect.poll(() => speechControl.requests.length).toBe(2);
  await page.getByRole('button', { name: '片段 1 配音更多操作', exact: true }).press('Enter');
  await expect(page.locator('[data-speech-generate]')).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape'); await expect(page.locator(`[row-id="${id}"]`).getByRole('button', { name: '试听', exact: true })).toBeEnabled();
  speechControl.release(); await expect.poll(async () => (await querySpeech(project.url)).locked).toBe(false);
  expect(speechControl.requests).toHaveLength(2);
});

test.describe('未配置声音', () => {
  test.use({ speechRuntime: { key: () => '', configPath: '/controlled/unconfigured.env' } });
  test('未配置凭据仍可查看设置并给出本机配置说明', async ({ page, project }) => {
    await page.goto(project.url); await page.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('button', { name: '声音设置', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '统一声音设置', exact: true });
    await expect(dialog).toContainText('TokenDance 凭据：未配置');
    await expect(dialog).toContainText('/controlled/unconfigured.env'); await expect(dialog).toContainText('TOKENDANCE_KEY');
  });
});

test('保留上限移除正在试听的旧音频后停止并移除播放器', async ({ page, project }) => {
  const [id] = await project.seed(['A']);
  await submitSpeech(project.url, { requestId: randomUUID(), segmentId: id! });
  await expect.poll(async () => (await querySpeech(project.url)).locked).toBe(false);
  await page.goto(project.url); await page.locator(`[row-id="${id}"]`).getByRole('button', { name: '试听', exact: true }).click();
  await expect.poll(() => page.locator('main > audio').evaluate(node => !(node as HTMLAudioElement).paused)).toBe(true);
  for (let i = 0; i < 3; i++) {
    await submitSpeech(project.url, { requestId: randomUUID(), segmentId: id! });
    await expect.poll(async () => (await querySpeech(project.url)).locked).toBe(false);
  }
  await expect(page.locator('main > audio')).toHaveCount(0);
  expect((await querySpeech(project.url)).audio).toHaveLength(3);
});

test('结果未知仍保留旧有效音频，完整计费警告可从历史访问', async ({ page, project, speechControl }) => {
  const [id] = await project.seed(['A']); await submitSpeech(project.url, { requestId: randomUUID(), segmentId: id! });
  await expect.poll(async () => (await querySpeech(project.url)).locked).toBe(false);
  speechControl.mode = 'unknown'; await submitSpeech(project.url, { requestId: randomUUID(), segmentId: id! });
  await expect.poll(async () => (await querySpeech(project.url)).tasks.at(-1)!.state).toBe('unknown');
  await page.goto(project.url); const row = page.locator(`[row-id="${id}"]`);
  await expect(row).toContainText('有效配音'); await expect(row).toContainText('结果未知');
  await expect(row.getByRole('button', { name: '试听', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '片段 1 配音更多操作', exact: true }).press('Enter');
  await page.getByRole('menuitem', { name: '保留音频与任务记录', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '配音详情与保留音频', exact: true })).toContainText('可能已计费');
  expect((await querySpeech(project.url)).audio).toHaveLength(1);
});
