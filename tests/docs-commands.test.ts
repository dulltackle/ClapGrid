import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, test } from 'vitest';
import { checkDocs } from './helpers/docs-contract.js';

const roots: string[] = [];
function repository(files: Record<string, string>): string {
  const root = mkdtempSync(resolve(tmpdir(), 'clapgrid-docs-'));
  roots.push(root);
  for (const [file, content] of Object.entries({ 'package.json': '{"scripts":{"test":"vitest run"}}', ...files })) {
    mkdirSync(dirname(resolve(root, file)), { recursive: true });
    writeFileSync(resolve(root, file), content);
  }
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['add', '.'], { cwd: root });
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test('当前指南拒绝不存在的 npm script', () => {
  expect(checkDocs(repository({ 'README.md': '`npm run missing`' }))).toEqual([
    'README.md: 未定义 npm script：missing',
  ]);
});

test('原生测试命令拒绝不存在的显式测试路径', () => {
  expect(checkDocs(repository({ 'README.md': '`npm exec vitest -- run tests/missing.test.ts`\n`npm exec playwright -- test tests/missing.spec.ts`' }))).toEqual([
    'README.md: 测试路径不存在：tests/missing.test.ts',
    'README.md: 测试路径不存在：tests/missing.spec.ts',
  ]);
});

test.each(['tsx --test', 'node --import tsx --test'])('当前指南拒绝废弃命令 %s', command => {
  expect(checkDocs(repository({ 'README.md': command }))).toEqual([`README.md: 废弃测试命令：${command}`]);
});

test('当前指南拒绝失效的相对链接', () => {
  expect(checkDocs(repository({ 'README.md': '[缺失](docs/missing.md#章节)' }))).toEqual([
    'README.md: 相对链接不存在：docs/missing.md#章节',
  ]);
});

test('当前指南必须从根目录文档或插件 SKILL 沿相对链接可达', () => {
  expect(checkDocs(repository({
    'README.md': '[入口](docs/start.md)',
    'docs/start.md': '[子页](child.md)',
    'docs/child.md': '',
    'docs/orphan.md': '[另一个孤儿](cycle.md)',
    'docs/cycle.md': '[环](orphan.md)',
  }))).toEqual(['docs/cycle.md: 孤立当前指南', 'docs/orphan.md: 孤立当前指南']);
});

test('ADR 与夹具不检查命令、链接或孤立状态，其他目录默认受检', () => {
  const files = Object.fromEntries(['docs/adr', 'tests/fixtures'].map(dir => [
    `${dir}/old.md`, 'npm run missing\ntsx --test\nnode --import tsx --test\n[旧路径](missing.md)\nnpm exec vitest -- run tests/missing.ts',
  ]));
  expect(checkDocs(repository({ 'README.md': '', ...files }))).toEqual([]);
  expect(checkDocs(repository({ 'README.md': '', 'new/guide.md': '', 'docs/validation/old.md': '' }))).toEqual([
    'docs/validation/old.md: 孤立当前指南',
    'new/guide.md: 孤立当前指南',
  ]);
});

test('仓库当前指南满足文档契约', () => {
  expect(checkDocs(resolve(import.meta.dirname, '..'))).toEqual([]);
});

test('链接校验覆盖引用式、带标题、编码路径与括号路径', () => {
  expect(checkDocs(repository({ 'README.md': '[引用][guide]\n[guide]: docs/missing.md "标题"\n[括号](docs/a(b).md)\n[空格](<docs/a b.md>)' }))).toEqual([
    'README.md: 相对链接不存在：docs/missing.md',
    'README.md: 相对链接不存在：docs/a(b).md',
    'README.md: 相对链接不存在：docs/a b.md',
  ]);
});

test('有效命令、插件入口、跨页链接和未跟踪草稿不会误报', () => {
  const root = repository({
    'README.md': '[指南][guide]\n[guide]: docs/guide.md "指南"\n[远程](https://example.com/missing)\n[章节](#标题)',
    'docs/guide.md': 'npm run test\nnpm exec vitest -- run "tests/example.test.ts"\nnpm exec playwright -- test tests/example.spec.ts\nnpm exec other -- tests/not-checked.ts\n[编码路径](a%20b.md?raw=1#标题)',
    'docs/a b.md': '[括号](a(b).md)',
    'docs/a(b).md': '[回环](guide.md)',
    'plugins/example/skills/open/SKILL.md': '[插件指南](guide.md)',
    'plugins/example/skills/open/guide.md': '',
    'tests/example.test.ts': '',
    'tests/example.spec.ts': '',
  });
  writeFileSync(resolve(root, 'docs/draft.md'), 'npm run missing');
  expect(checkDocs(root)).toEqual([]);
});

test('代码示例与注释中的链接不能作为指南导航', () => {
  expect(checkDocs(repository({
    'README.md': '```md\n[示例](docs/orphan.md)\n```\n`[示例](docs/orphan.md)`\n<!-- [示例](docs/orphan.md) -->',
    'docs/orphan.md': '',
  }))).toEqual(['docs/orphan.md: 孤立当前指南']);
});

test('npm script 名称保留点号且支持引号', () => {
  expect(checkDocs(repository({ 'README.md': '`npm run test.missing`\n`npm run "quoted-missing"`' }))).toEqual([
    'README.md: 未定义 npm script：test.missing',
    'README.md: 未定义 npm script：quoted-missing',
  ]);
});

test('原生测试命令检查 shell 续行中的显式路径', () => {
  expect(checkDocs(repository({ 'README.md': 'npm exec vitest -- run \\\n  tests/missing.test.ts' }))).toEqual([
    'README.md: 测试路径不存在：tests/missing.test.ts',
  ]);
});
