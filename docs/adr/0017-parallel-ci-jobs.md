# 主检查拆为并行 job，以墙钟优先

日期：2026-11-07

状态：已采纳（用户 2026-11-07 确认；同日修订为 Vitest 也分片，见“修订”）。取代 [ADR0011](0011-native-test-frameworks.md) 中“同一 runner、总占用不增加，不通过增加机器或分片达成目标”一句；ADR0011 其余内容不变。

## 背景

主检查在单个 job 内依次执行类型检查、Vitest、Playwright 与生产构建，每个 PR 墙钟约 11–14 分钟。环境准备约 1 分钟，其余几乎全部是两套测试串行：Vitest 约 7–8 分钟，Playwright 约 4–5 分钟。两套测试互不依赖。在同一 runner 内提高并发已实测到头：Vitest 4 workers 收益很小且失败增多（[#212](https://github.com/dulltackle/ClapGrid/issues/212)），Playwright 取 3 workers 为最优（[#215](https://github.com/dulltackle/ClapGrid/issues/215)）。

## 决策

主检查的取舍改为墙钟优先：允许用多个并行 job 和原生分片缩短 PR 等待，接受每个 job 重复环境准备带来的 runner 总占用增加。

- `check.yml` 拆为类型检查与生产构建、Vitest 分 3 片、Playwright 分 2 片三组并行 job；测试 job 共用本地 composite action 准备同一环境。
- 汇总 job 保留 `check` 名称，分支保护的必需检查不变；任一阶段失败、取消或跳过都使 `check` 失败。
- 每片 Playwright、Vitest 各自保存原生报告与日志，artifact 按阶段和分片命名；不合并跨分片报告，也不新增报告格式。
- 分片使用框架原生 `--shard`（按文件路径哈希均分文件数），不按历史耗时自建分配；ADR0011 已将调度协议列为退出范围。
- 各 job 内的 worker 数、`fullyParallel` 关闭、零重试、`deadline` project 独占末尾执行等配置不变；更改仍须按 CI 实测决定。

## 否决的方案

- **只在单 job 内继续调高 worker 数**：#212 与 #215 已在 4 vCPU runner 实测，再增加并发收益很小且失败增多。
- **用 blob reporter 合并分片报告**：会多一个 merge job 和中间格式，违背 ADR0011 直接使用原生报告；分片报告分别保存已足够诊断。
- **按历史耗时手工平衡分片**（自定义 sequencer 或固定文件清单）：属于 ADR0011 退出范围的自研调度，且文件增删后需持续维护。

## 后果

- 每个 PR 比单 job 多做 4 次测试环境准备（5 个测试 job 各一次）；性能结论仍须同时披露墙钟与总 runner 占用。
- 系统依赖缓存可能被多个并行 job 同时保存，后保存者只告警。
- 失败排查须按分片定位对应 artifact。
- 原生分片按文件数而非耗时均分，各片负载不均；最慢一片决定 Vitest 墙钟，增加片数前先按 CI 实测比较。

## 修订（2026-11-07）

初版否决“Vitest 也分片”，理由是最慢文件 `page-render.test.ts` 在单文件内串行，分片缩短不了关键路径。该文件的 READY 超时用例改为可缩短等待后，它从 264s 降到 138s（PR #299 的 CI 运行），Vitest 的墙钟改由全部文件耗时之和（约 750s）除以 2 workers 决定，分片能直接缩短。按原生分片算法与该轮各文件耗时估算，各片最慢一片的测试墙钟：不分片约 375s，2 片约 246s，3 片约 147s，4 片约 166s（哈希分配使 4 片反而更不均）；取 3 片。该否决理由不再成立，改为采纳。
