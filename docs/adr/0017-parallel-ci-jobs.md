# 主检查拆为并行 job，以墙钟优先

日期：2026-11-07

状态：已采纳（用户 2026-11-07 确认）。取代 [ADR0011](0011-native-test-frameworks.md) 中“同一 runner、总占用不增加，不通过增加机器或分片达成目标”一句；ADR0011 其余内容不变。

## 背景

主检查在单个 job 内依次执行类型检查、Vitest、Playwright 与生产构建，每个 PR 墙钟约 11–14 分钟。环境准备约 1 分钟，其余几乎全部是两套测试串行：Vitest 约 7–8 分钟，Playwright 约 4–5 分钟。两套测试互不依赖。在同一 runner 内提高并发已实测到头：Vitest 4 workers 收益很小且失败增多（[#212](https://github.com/dulltackle/ClapGrid/issues/212)），Playwright 取 3 workers 为最优（[#215](https://github.com/dulltackle/ClapGrid/issues/215)）。

## 决策

主检查的取舍改为墙钟优先：允许用多个并行 job 和 Playwright 分片缩短 PR 等待，接受每个 job 重复环境准备带来的 runner 总占用增加。

- `check.yml` 拆为类型检查与生产构建、全套 Vitest、Playwright 分 2 片三组并行 job；测试 job 共用本地 composite action 准备同一环境。
- 汇总 job 保留 `check` 名称，分支保护的必需检查不变；任一阶段失败、取消或跳过都使 `check` 失败。
- 每片 Playwright、Vitest 各自保存原生报告与日志，artifact 按阶段和分片命名；不合并跨分片报告，也不新增报告格式。
- 各 job 内的 worker 数、`fullyParallel` 关闭、零重试等配置不变；更改仍须按 CI 实测决定。

## 否决的方案

- **只在单 job 内继续调高 worker 数**：#212 与 #215 已在 4 vCPU runner 实测，再增加并发收益很小且失败增多。
- **用 blob reporter 合并分片报告**：会多一个 merge job 和中间格式，违背 ADR0011 直接使用原生报告；分片报告分别保存已足够诊断。
- **Vitest 也分片**：最慢文件在单文件内串行，分片无法缩短该关键路径；先按测量再决定。

## 后果

- 每个 PR 多占约 3 个 job 的环境准备时间；性能结论仍须同时披露墙钟与总 runner 占用。
- 系统依赖缓存可能被两个并行 job 同时保存，后保存者只告警。
- 失败排查须按分片定位对应 artifact。
