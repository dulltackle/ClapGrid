import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import type { BuildIdentity } from '../src/build-identity.js';

const exec = promisify(execFile);
const hash = (character: string) => `sha256:${character.repeat(64)}`;

async function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-plugin-source-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  const data = join(root, 'data');
  mkdirSync(join(source, 'src/panel'), { recursive: true });
  mkdirSync(join(data, 'clapgrid'), { recursive: true });
  writeFileSync(join(source, 'src/panel/app.tsx'), 'export const label = "原始面板";');
  writeFileSync(join(source, 'src/panel/style.css'), 'body { color: black; }');
  const git = async (...args: string[]) => (await exec('git', ['--no-pager', '-C', source, ...args])).stdout.trim();
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
  const check = () => exec(process.execPath, [entry], { env: { ...process.env, XDG_DATA_HOME: data } });
  return { source, commit, loaded, receipt, check };
}

for (const [path, contents] of [
  ['app.tsx', 'export const label = "更新后的面板";'],
  ['style.css', 'body { color: blue; }'],
] as const) {
  test(`schema 2 安装后仅提交 ${path} 仍提示源码更新，更新收据后相容运行时继续使用`, async t => {
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

test('仅提交文档且插件源码未变时不误报更新', async t => {
  const { source, commit, check } = await fixture(t);
  writeFileSync(join(source, 'README.md'), '仅更新说明文档');
  await commit();
  await check();
});
