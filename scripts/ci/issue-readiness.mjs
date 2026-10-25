/** 检查 verify-acceptance 约定的唯一二级验收区域。 */
export function checkAcceptanceRegion(body) {
  let fence;
  const lines = (body ?? '').split(/\r?\n/).map((line) => {
    if (fence) {
      const closing = /^ {0,3}(`{3,}|~{3,})[\t ]*$/.exec(line);
      if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length) fence = undefined;
      return '';
    }
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (opening && (opening[1][0] !== '`' || !opening[2].includes('`'))) {
      fence = opening[1];
      return '';
    }
    return line;
  });
  const headings = [];
  for (let index = 0; index < lines.length; index++) {
    const heading = /^ {0,3}##[\t ]+(.+?)\s*$/.exec(lines[index]);
    if (heading && /^(验收标准|验收条件|Acceptance criteria)$/i.test(heading[1].trim())) headings.push(index);
  }
  if (headings.length === 0) return { valid: false, reason: '缺少合规二级验收标题：## 验收标准、## 验收条件或 ## Acceptance criteria。' };
  if (headings.length > 1) return { valid: false, reason: '存在多个合规验收标题；正文必须有且只有一个验收区域。' };
  for (let index = headings[0] + 1; index < lines.length; index++) {
    if (/^ {0,3}##(?:[\t ]|$)/.test(lines[index])) break;
    if (/^\s*- \[[ xX]\][\t ]+\S/.test(lines[index])) return { valid: true, reason: '' };
  }
  return { valid: false, reason: '验收区域内至少需要一条带文字的复选项（- [ ] 或 - [x]）。' };
}

const marker = '<!-- clapgrid:issue-readiness -->';
const readyLabels = ['ready-for-agent', 'ready-for-human'];

/** GitHub API 是唯一副作用边界；不使用事件快照决定标签或正文。 */
export async function enforceIssueReadiness(github, context) {
  const target = { ...context.repo, issue_number: context.issue.number };
  const { data: issue } = await github.rest.issues.get(target);
  const labels = issue.labels.map((label) => typeof label === 'string' ? label : label.name);
  if (issue.state !== 'open' || !labels.some((name) => readyLabels.includes(name))) return;

  const result = checkAcceptanceRegion(issue.body);
  const comments = await github.paginate(github.rest.issues.listComments, { ...target, per_page: 100 });
  const comment = comments.find((entry) => entry.user?.login === 'github-actions[bot]' && entry.body?.includes(marker));
  if (result.valid && !comment) return;

  if (result.valid) {
    if (labels.includes('needs-info')) await github.rest.issues.removeLabel({ ...target, name: 'needs-info' });
  } else {
    for (const name of readyLabels.filter((name) => labels.includes(name))) {
      await github.rest.issues.removeLabel({ ...target, name });
    }
    if (!labels.includes('needs-info')) await github.rest.issues.addLabels({ ...target, labels: ['needs-info'] });
  }

  const body = result.valid
    ? `${marker}\n验收区域检查已通过：正文具有唯一合规验收标题及非空复选项。此检查只验证格式，不代表验收内容已实现。`
    : `${marker}\n验收区域检查未通过：${result.reason}\n\n已移除 ready-for-agent / ready-for-human 并标记 needs-info。请补齐正文后重新添加所需 ready 标签以触发复查。规范见 docs/agents/issue-tracker.md。`;
  if (comment) {
    if (comment.body !== body) await github.rest.issues.updateComment({ ...context.repo, comment_id: comment.id, body });
  } else {
    await github.rest.issues.createComment({ ...target, body });
  }
}
