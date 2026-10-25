import { expect, test } from 'vitest';
import { checkAcceptanceRegion } from '../scripts/ci/issue-readiness.mjs';

test('合规二级验收区域接受有文字的复选项', () => {
  expect(checkAcceptanceRegion('## 验收标准\n- [ ] 完成检查')).toEqual({ valid: true, reason: '' });
});

test.each(['验收标准', '验收条件', 'Acceptance criteria', 'aCCEPTANCE CRITERIA'])('接受标题 %s', (heading) => {
  expect(checkAcceptanceRegion(`## ${heading}\n- [x] 已完成`).valid).toBe(true);
});

test.each([
  '# 验收标准\n- [ ] 内容', '### 验收标准\n- [ ] 内容', '## 验收条款\n- [ ] 内容',
  '## Acceptance criteria:\n- [ ] 内容', '## 验收标准', '## 验收标准\n- [ ]   \n- [x]\t',
  '## 验收标准\n## 其他\n- [ ] 内容', '## 验收标准\n- [ ] 内容\n## 验收条件\n- [ ] 其他',
  '## 验收标准\n## 验收标准\n- [ ] 内容',
])('拒绝不合规正文 %s', (body) => {
  expect(checkAcceptanceRegion(body)).toMatchObject({ valid: false, reason: expect.any(String) });
  expect(checkAcceptanceRegion(body).reason.length).toBeGreaterThan(0);
});

test('下级标题仍在区域内，CRLF 和已选复选项可用', () => {
  expect(checkAcceptanceRegion('## 验收条件\r\n### 细节\r\n- [X] 验证\r\n## 备注').valid).toBe(true);
});

test('不合规 Issue 撤下 ready 标签并复用机器人说明评论', async () => {
  const { enforceIssueReadiness } = await import('../scripts/ci/issue-readiness.mjs');
  const fixture = issueFixture('## 验收条款\n- [ ] 内容');
  await enforceIssueReadiness(fixture.github, fixture.context);
  expect(fixture.labels).toEqual(['feature', 'needs-info']);
  expect(fixture.comments).toHaveLength(1);
  expect(fixture.comments[0]?.body).toContain('<!-- clapgrid:issue-readiness -->');
  fixture.labels.push('ready-for-human');
  await enforceIssueReadiness(fixture.github, fixture.context);
  expect(fixture.comments).toHaveLength(1);
});

function issueFixture(body: string | null, labels = ['feature', 'ready-for-agent', 'ready-for-human']) {
  const comments: { id: number; body: string; user: { login: string } }[] = [];
  const writes: unknown[] = [];
  const issue = { body, state: 'open', labels: labels.map((name) => ({ name })) };
  const issues = {
    get: async () => ({ data: { ...issue, labels: labels.map((name) => ({ name })) } }),
    listComments: async () => ({ data: comments }),
    removeLabel: async (args: { name: string }) => { writes.push(args); labels.splice(labels.indexOf(args.name), 1); },
    addLabels: async (args: { labels: string[] }) => { writes.push(args); labels.push(...args.labels); },
    createComment: async (args: { body: string }) => { writes.push(args); comments.push({ id: comments.length + 1, body: args.body, user: { login: 'github-actions[bot]' } }); },
    updateComment: async (args: { comment_id: number; body: string }) => { writes.push(args); comments.find((comment) => comment.id === args.comment_id)!.body = args.body; },
  };
  const github = { rest: { issues }, paginate: async () => comments };
  return { github, context: { repo: { owner: 'test', repo: 'test' }, issue: { number: 253 } }, labels, comments, writes, issue };
}

test('此前被拦截的 Issue 修复后清除 needs-info 并更新原评论', async () => {
  const { enforceIssueReadiness } = await import('../scripts/ci/issue-readiness.mjs');
  const fixture = issueFixture(null);
  await enforceIssueReadiness(fixture.github, fixture.context);
  fixture.issue.body = '## 验收条件\n- [ ] 验证行为';
  fixture.labels.push('ready-for-agent');
  await enforceIssueReadiness(fixture.github, fixture.context);
  expect(fixture.labels).toEqual(['feature', 'ready-for-agent']);
  expect(fixture.comments).toHaveLength(1);
  expect(fixture.comments[0]?.body).toContain('已通过');
  const previousWrites = fixture.writes.length;
  await enforceIssueReadiness(fixture.github, fixture.context);
  expect(fixture.writes).toHaveLength(previousWrites);
});

test('首次检查合规正文无任何写操作，即使存在 needs-info', async () => {
  const { enforceIssueReadiness } = await import('../scripts/ci/issue-readiness.mjs');
  const fixture = issueFixture('## Acceptance criteria\n- [ ] 内容', ['ready-for-agent', 'needs-info']);
  await enforceIssueReadiness(fixture.github, fixture.context);
  expect(fixture.writes).toEqual([]);
});

test.each(['closed', 'unlabeled'])('当前状态为 %s 时不处理旧事件', async (state) => {
  const { enforceIssueReadiness } = await import('../scripts/ci/issue-readiness.mjs');
  const fixture = issueFixture('缺少验收区域');
  if (state === 'closed') fixture.issue.state = 'closed';
  else fixture.labels.splice(0, fixture.labels.length, 'needs-triage');
  await enforceIssueReadiness(fixture.github, fixture.context);
  expect(fixture.writes).toEqual([]);
});

test('不把用户复制的标记当成机器人拦截记录', async () => {
  const { enforceIssueReadiness } = await import('../scripts/ci/issue-readiness.mjs');
  const fixture = issueFixture('## 验收标准\n- [ ] 内容', ['ready-for-human', 'needs-info']);
  fixture.comments.push({ id: 1, body: '<!-- clapgrid:issue-readiness -->', user: { login: 'maintainer' } });
  await enforceIssueReadiness(fixture.github, fixture.context);
  expect(fixture.writes).toEqual([]);
});

test('分页后的机器人评论仍被复用，其他评论保持原样', async () => {
  const { enforceIssueReadiness } = await import('../scripts/ci/issue-readiness.mjs');
  const fixture = issueFixture('缺少验收区域');
  fixture.comments.push(...Array.from({ length: 100 }, (_, index) => ({ id: index + 1, body: '讨论', user: { login: 'maintainer' } })));
  fixture.comments.push({ id: 101, body: '<!-- clapgrid:issue-readiness -->\n旧说明', user: { login: 'github-actions[bot]' } });
  await enforceIssueReadiness(fixture.github, fixture.context);
  expect(fixture.comments).toHaveLength(101);
  expect(fixture.comments[0]?.body).toBe('讨论');
  expect(fixture.comments[100]?.body).toContain('未通过');
});

test('API 失败向 workflow 传播，不报告检查成功', async () => {
  const { enforceIssueReadiness } = await import('../scripts/ci/issue-readiness.mjs');
  const fixture = issueFixture('缺少验收区域');
  fixture.github.rest.issues.removeLabel = async () => { throw new Error('API unavailable'); };
  await expect(enforceIssueReadiness(fixture.github, fixture.context)).rejects.toThrow('API unavailable');
});

test.each(['```', '~~~~'])('代码围栏 %s 中的示例不构成验收区域', (fence) => {
  expect(checkAcceptanceRegion(`${fence}markdown\n## 验收标准\n- [ ] 示例\n${fence}`).valid).toBe(false);
  expect(checkAcceptanceRegion(`## 验收条件\n- [ ] 实际要求\n${fence}\n## 验收标准\n- [ ] 示例\n${fence}`).valid).toBe(true);
});

test('围栏中的二级标题不结束区域，围栏中的复选项不构成要求', () => {
  expect(checkAcceptanceRegion('## 验收标准\n```\n## 示例\n```\n- [ ] 实际要求').valid).toBe(true);
  expect(checkAcceptanceRegion('## 验收标准\n```\n- [ ] 示例\n```').valid).toBe(false);
});
