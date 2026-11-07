import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { test } from './helpers/resource-test.js';
import { fullPage, pageProject } from './helpers/page-project.js';

for (const [name, id, duration, text] of [
  ['等距信息图', 'iso-infographic', 12, '入口压力推开阀片，弹簧被压缩，流体便沿箭头通过阀体。'],
  ['暖浅底科普风', 'warm-science', 18, '先看摆球怎样来回运动，再比较两种摆长。\n最后用图标和比例条读出三组种子的数量。'],
] as const) {
  test(`内置${name}的示例可导入、确定性抽帧并合成带字幕的预览`, async ({ createDirectory, execBytes, startService }) => {
    const p = await pageProject({ createDirectory, execBytes, startService }, duration, false, text);
    const style = new URL(`../plugins/clapgrid/styles/${id}/`, import.meta.url);
    const styleDirectory = join(p.root, 'builtin-style');
    cpSync(style, styleDirectory, { recursive: true });
    await p.setStyle(styleDirectory);
    const sourceDirectory = join(p.root, 'example');
    cpSync(new URL('example/', style), sourceDirectory, { recursive: true });
    const { page } = await p.post('/api/codex/import-page', { sourceDirectory });
    await p.save([fullPage(page.pageId, p.duration)]);

    const { layers: [checked] } = await p.post('/api/page/check', { segmentId: p.segmentId });
    expect(checked).toMatchObject({
      text: { status: 'passed', issues: [] },
      determinism: { warnings: [], mismatchedTimes: [] },
    });
    const preview = await p.task('preview', 120000);
    expect(preview, JSON.stringify(preview)).toMatchObject({ state: 'succeeded', current: true });
    expect(preview.preview?.subtitleIssue).toBeUndefined();
  }, 150000);
}
