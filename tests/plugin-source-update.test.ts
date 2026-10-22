import { test, type ResourceFixtures } from './helpers/resource-test.js';
import assert from 'node:assert/strict';
import { vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import type { BuildIdentity } from '../src/build-identity.js';

type Resources = Pick<ResourceFixtures, 'createDirectory' | 'execCommand'>;

const hash = (character: string) => `sha256:${character.repeat(64)}`;

async function fixture(t: Pick<Resources, 'createDirectory' | 'execCommand'>) {
  const root = t.createDirectory(join(tmpdir(), 'clapgrid-plugin-source-'));
  const source = join(root, 'source');
  const data = join(root, 'data');
  mkdirSync(join(source, 'src/panel'), { recursive: true });
  mkdirSync(join(data, 'clapgrid'), { recursive: true });
  writeFileSync(join(source, 'src/panel/app.tsx'), 'export const label = "原始面板";');
  writeFileSync(join(source, 'src/panel/style.css'), 'body { color: black; }');
  const git = async (...args: string[]) => (await t.execCommand('git', ['--no-pager', '-C', source, ...args])).stdout.trim();
  const commit = async () => {
    await git('add', '.');
    await git('-c', 'user.name=测试', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'test: 更新面板源码');
    return git('rev-parse', 'HEAD');
  };
  await git('init', '-q');
  const installedCommit = await commit();
  const loaded: BuildIdentity = { schemaVersion: 2, state: 'known', version: 'source-update-test',
    source: { commit: installedCommit, state: 'clean' }, contentFingerprint: hash('a'),
    runtimeFingerprint: hash('b'), panelFingerprint: hash('c'), protocolVersion: 1 };
  const receipt = (identity = loaded) => writeFileSync(join(data, 'clapgrid/plugin-update.json'), JSON.stringify({ identity, sourceRepository: source }));
  receipt();
  const entry = join(root, 'check.mjs');
  // 仅注入构建身份；实际更新检查、收据读取和 Git 比较均参与。
  await build({
    stdin: { contents: `import { verifyLoadedPlugin } from ${JSON.stringify(resolve('src/plugin-release.ts'))}; await verifyLoadedPlugin();`, resolveDir: resolve('.') },
    bundle: true, platform: 'node', format: 'esm', outfile: entry,
    define: { __CLAPGRID_BUILD_IDENTITY__: JSON.stringify(loaded) },
  });
  const check = () => t.execCommand(process.execPath, [entry], { env: { ...process.env, XDG_DATA_HOME: data } });
  return { source, commit, loaded, receipt, check };
}

for (const [path, contents] of [
  ['app.tsx', 'export const label = "更新后的面板";'],
  ['style.css', 'body { color: blue; }'],
] as const) {
  test(`schema 2 安装后仅提交 ${path} 仍提示源码更新，更新收据后相容运行时继续使用`, async ({ createDirectory, execCommand }) => {
  const t = { createDirectory, execCommand };
    const { source, commit, loaded, receipt, check } = await fixture(t);
    await check();
    writeFileSync(join(source, 'src/panel', path), contents);
    const nextCommit = await commit();
    await assert.rejects(check(), /插件源码已有更新/);
    receipt({ ...loaded, source: { commit: nextCommit, state: 'clean' },
      contentFingerprint: hash('d'), panelFingerprint: hash('e') });
    await check();
  });
}

test('仅提交文档且插件源码未变时不误报更新', async ({ createDirectory, execCommand }) => {
  const t = { createDirectory, execCommand };
  const { source, commit, check } = await fixture(t);
  writeFileSync(join(source, 'README.md'), '仅更新说明文档');
  await commit();
  await check();
});
