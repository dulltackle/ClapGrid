# 事项追踪：GitHub

事项和规格存放于 dulltackle/ClapGrid 的 GitHub Issues。
使用 gh CLI，显式指定 --repo dulltackle/ClapGrid。

## ready 标签与验收区域

任何标为 `ready-for-agent` 或 `ready-for-human` 的 Issue（包括 Spec）必须在正文中有且只有一个合规的二级验收标题。标题文字去除首尾空白后，仅接受以下三种措辞：

- `## 验收标准`
- `## 验收条件`
- `## Acceptance criteria`（英文不区分大小写）

验收区域从该标题延伸至下一个二级标题，其下至少有一条带文字的复选项：`- [ ] 验证内容` 或 `- [x] 已验证内容`。一级、三级标题、其他措辞、重复验收标题、空区域及仅有无文字复选项均不合格。发布 Spec 或其他 Issue 的技能在添加 ready 标签前须遵守此约定。

[验收区域 workflow](../../.github/workflows/issue-readiness.yml)在 Issue 打开、加标签或编辑时，对仍打开且带上述 ready 标签的 Issue 复查。不合格时移除两个 ready 标签、添加 `needs-info`，并创建或更新同一条机器人说明评论。修复正文后重新添加所需 ready 标签触发复查；合格且存在该机器人的拦截标记评论时，移除 `needs-info` 并将原评论更新为已通过。首次合规的 Issue 不做写操作。此检查只验证区域格式，不代表验收条目已实现，不自动关闭或重开 Issue。

## 常用操作

- 创建：gh issue create --title "标题" --body-file <正文文件>
- 读取：gh issue view <编号> --comments；另用 --json labels 获取标签。
- 列表：gh issue list --state open --json number,title,body,labels,comments
- 评论：gh issue comment <编号> --body-file <正文文件>
- 标签：gh issue edit <编号> --add-label <标签> 或 --remove-label <标签>
- 关闭：gh issue close <编号> --comment "关闭原因"

以上命令均须附加仓库参数。多行正文写入临时文件后通过 --body-file 传入。
按任务需要设置 --label 和 --state 筛选。

技能要求“发布到事项追踪系统”时，创建 GitHub Issue。
技能要求“获取相关工单”时，读取对应 Issue 及评论。

## PR 作为请求入口

PRs as a request surface: no.

GitHub 的 Issue 和 PR 共用编号空间。编号类型不明确时，
先用 gh pr view 检查，再回退到 gh issue view。

## Wayfinder 操作

- 地图：创建带 wayfinder:map 标签的 Issue，记录笔记、已有决策和待澄清事项。
- 子工单：通过 gh api 建立 sub-issue 关联；不可用时，在地图正文中列出任务，
  并在子工单顶部添加 Part of #<地图编号>。
- 类型：使用 wayfinder:research、wayfinder:prototype、
  wayfinder:grilling 或 wayfinder:task 标签。
- 阻塞：优先使用 GitHub 原生 Issue 依赖。
  通过 gh api 向 repos/dulltackle/ClapGrid/issues/<子工单编号>/dependencies/blocked_by
  发起 POST，issue_id 使用阻塞事项的数据库 id，而非事项编号或 node_id。
  不可用时，在正文顶部记录 Blocked by: #<编号>。
- 可执行工单：按地图顺序选择尚未关闭、没有未关闭阻塞项且无人认领的第一个子工单。
  原生依赖通过 issue_dependencies_summary.blocked_by 判断。
- 认领：开始工作前，用 gh issue edit <编号> --add-assignee @me 分配。
- 完成：发表评论说明结果、关闭子工单，并向地图的已有决策追加摘要和链接。
