# 事项追踪：GitHub

事项和规格存放于 dulltackle/ClapGrid 的 GitHub Issues。
使用 gh CLI，显式指定 --repo dulltackle/ClapGrid。

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
