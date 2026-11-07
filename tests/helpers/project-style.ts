import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { importStyle, queryStatus, setProjectStyle } from '../../src/shared/client.js';
import type { openBusiness } from '../../src/business/index.js';

export async function selectTestStyle(target: string | ReturnType<typeof openBusiness>) {
  const snapshot = typeof target === 'string' ? (await queryStatus(target)).snapshot : target.getSnapshot();
  const expected = snapshot.projectStyle?.styleId ?? null;
  const sourceDirectory = mkdtempSync(join(snapshot.project.directory, '.fixture-style-'));
  try {
    cpSync(new URL('../fixtures/style', import.meta.url), sourceDirectory, { recursive: true });
    if (typeof target === 'string') {
      const { style } = await importStyle(target, sourceDirectory);
      await setProjectStyle(target, { expected, styleId: style.styleId });
      return style.styleId;
    }
    const token = target.acquire('codex');
    try {
      const { styleId } = await target.importStyle(token, sourceDirectory, dirname(snapshot.project.directory));
      await target.setProjectStyle(token, { expected, styleId });
      return styleId;
    } finally { target.release(token); }
  } finally { rmSync(sourceDirectory, { recursive: true, force: true }); }
}
