import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const checker = resolve('scripts/check-review-links.mjs');
test('审查规范的本地上下文指针能到达目标，失效链接使检查失败', () => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-review-links-'));
  try {
    mkdirSync(join(root, '.opencodereview'));
    writeFileSync(join(root, 'CODING_STANDARDS.md'), '[规则](.opencodereview/rule.json)\n');
    writeFileSync(join(root, '.opencodereview/rule.json'), JSON.stringify({ rules: [
      { path: '**/*', rule: '依据 [架构](../ADR.md) 审查；[历史](https://example.com) 仅为来源。' },
    ] }));
    writeFileSync(join(root, 'ADR.md'), '# 架构\n');
    const run = () => spawnSync(process.execPath, [checker, root], { encoding: 'utf8' });
    assert.equal(run().status, 0);
    rmSync(join(root, 'ADR.md'));
    const broken = run();
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /ADR\.md/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('仓库当前审查上下文链接通过确定性检查', () => {
  const result = spawnSync(process.execPath, [checker], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
