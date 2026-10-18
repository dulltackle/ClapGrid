# 原生执行与证据最小适配（#163）

本切片以 `1a7dc6c` 为初始实现基线，同步 #162 的 `12aabea` 后交付，只精简现有试点的报告加工，保持业务断言及公开入口。局部回归不是最终固定提交验收，最终全量检查、CI 对照和性能结论由 #172 汇总。

## 完整清单与场景对应

[清单与基线索引](baseline-and-inventory.json) 固定 110 个当前唯一归属文件、scope、业务 UI 政策及后续批次。[逐场景映射](scenario-map.tsv) 从 #160 的真实累计原报告保留每条旧文件、场景名、位置和原状态，显式映射到当前同文件同场景及执行者；不是仅用文件数或用例数宣称等价。110 个文件逐一与当前清单相符。#162 同步时，CI 并发检查旧场景更名为“CI 仅自动检查 PR 和 main push，手动及旧提交重跑隔离”，映射表显式记录旧名到新名，其余身份保持；保留原并发断言并增加 PR/main 触发条件。历史 1097 项是优化前真实收集，当前新增工具回归不假装已包含在旧原件中。本切片未改变任何业务测试正文；现有 [试点场景表](../../../scripts/test-pilot-baseline.json) 的 16 项逻辑、4 项真实 HTTP/SQLite、14 项 UI 原断言和对照快照 hash 继续有效。新增的报告故障注入是工具保障回归，独立增加覆盖，不替代旧场景。

批次以实际测试职责分配，后续实施时仍须逐例审阅，不能只按文件总数迁移：

| 批次 | 保留的执行方式与理由 |
| --- | --- |
| #163（9 文件） | 现有 Vitest 逻辑/服务及 Playwright 固定核心已实际原生执行，保留框架原生收集和失败反馈；本次不扩大迁移。 |
| #164（54 文件） | 其余逻辑、服务、插件与生产归档等暂留 Node，避免本切片混入业务、真实服务生命周期或异构工具迁移。 |
| #165（11 文件） | 表格编辑、行菜单、选择、搜索、拖拽等暂留 Node 浏览器 helper，后续逐例迁移，真实交互不能删除。 |
| #166（7 文件） | 添加、焦点、删除和弹窗暂留原浏览器启动与焦点恢复语义，后续批次确认隔离。 |
| #167（8 文件） | 配音、音视频、画面素材和导出面板保留真实媒体路径，后续迁移。 |
| #168（7 文件） | 其余布局、窄屏、壳层等特殊 UI 保持原环境条件，后续逐例核对。 |
| #169（11 文件） | 执行器、报告、准备缓存等工具专项保留 Node 驱动真实 CLI，后续按公开承诺精简。 |
| #170（3 文件） | check/watch/固定提交生命周期需真实跨进程控制，保留 Node 管理和取消专项，后续独立处理。 |

9 份 `.native.ts` 比较快照不进入常规 all，仍由 native-logic/native-service/native-ui 显式入口执行。既有预检同次累计去重不变；后续阶段仅调度剩余文件，最终累计记录仍引用原阶段的真实逐例报告。

## 保障如何承接及删减依据

| 旧保障或加工 | 当前承接点和处置 |
| --- | --- |
| Vitest 收集/完成两条独立集合 | 官方 `onTestModuleCollected` / `onTestCaseResult` 生命周期，保留轻量 reporter；不从成功结果反推预期集合。 |
| Vitest 全局错误、收集失败和取消 | `onTestModuleEnd`、`onTestRunEnd(errors, reason)` 及统一完整性校验；reason 非 passed/failed 时不完整。 |
| 第二份 Vitest 官方 JSON | 原先仅在 `additionalSources` 中计算 hash，无语义消费者，和 lifecycle reporter 重复遍历/序列化同批结果；从 API 与 CLI 两条启动路径一起移除，只保留单份原生事件来源及可读日志。 |
| Playwright 官方收集/结果、版本、位置 | 官方 JSON 的 suites/specs/test/results、config.version/metadata.executionId 保持；每例直接使用其 results，删除对累计 cases 的重复 filter。 |
| 报告身份和完整性 | `test-evidence.mjs:validateExecution` 继续核对实际依赖版本、nonce、完整文件/用例集合、摘要、来源 hash 与源码/配置/环境前后身份。 |
| 未迁移测试 | `test-inventory.json` 唯一归属及原 Node reporter/执行入口继续工作，混合入口和集中复验保留。 |
| 预检同次去重 | 原私有累计账本保留原 stage-proof、原 nonce 和原报告；没有新建历史成功复用路径。 |
| Chrome/context 隔离与所有权 | Playwright fixture 和 `playwright-resources.mjs` 继续负责独立 context/page/目录，生命周期 registry 检查拥有者和资源 marker。 |
| 取消/强杀 | 原 lifecycle 控制通道与进程组、登记资源收尾；本次不删除跨进程 wrapper，取消不产生通过。 |
| UI 严格政策 | 原 plan.strictFiles、清单 policy 与校验器继续逐例要求 passed，skip/todo/重试都不能掩盖失败。 |

统一报告 schema 2 不变，历史报告若含 `sources.additional` 仍校验旧来源；不改写原报告、不伪造新 nonce。原始官方生命周期事件属于原生执行证据；统一 JSON 是可核对的投影，不能独立放行。

## 优化前原件与测量边界

可信历史原件是 [#160 PR 合并结果 run 39095676733](https://github.com/dulltackle/ClapGrid/actions/runs/39095676733)，attempt 1，目标 `21c41f1a638795c1b6c23d2f1435c73f851d015d`。下载时 artifact 尚未过期；[远程 artifact](https://github.com/dulltackle/ClapGrid/actions/runs/39095676733/artifacts/12125158789) 保留期 14 天，不承诺永久在线。长期 Git 索引保留关键原值、完整历史场景身份及原件 SHA256；运行记录保全实际原报告与下载清单，不以临时下载路径作为唯一证据。若以后重验时原件不可取，须明确失效并补测，不将索引当原报告。

原 CI 首步骤至汇总 2524.065 秒，距 3600 秒时限余量 1075.935 秒，不包含 runner 准备及上传；正式验收从 04:02:35.253Z 至约 04:44:01Z。实际累计覆盖 1097 场景，其中 1097 passed，无 skip。Node 22.23.3、npm 10.9.9、Linux x64、Chrome for Testing 131.0.6778.204，runner、工具路径、字体、源码/tree 与环境指纹保留在索引。现有配置为 Node 文件并发 1、Vitest 单 worker、普通完整入口 Playwright 默认并发 1，UI 允许集合的显式并发 2 另列；此历史完整检查不能冒充并发 2 对照。独立 `npm ci` 安装，字节码默认仅用于受控 child，构建缓存可能同次预热；原件未提供逐个缓存命中与机器静默负载的完整快照，因此不将其与本机开发时长直接相减宣称收益。

## 定向证据与未完成边界

公开入口的 Vitest fresh/API 与 NODE_OPTIONS/CLI 路径均实际执行；先红后绿证明删除重复 JSON 同时保留独立收集、逐例位置与版本。新增报告注入覆盖损坏、集合缺口、错误 nonce 和取消；既有专项覆盖收集失败、断言失败、未捕获错误、缺报告、零收集、only、源码变化及实际取消/孙进程清理。Playwright 专项覆盖官方报告、真实 Chrome、context 隔离、worker 骤死、取消、资源 marker 损坏、严格 UI、混合三执行者预检去重。统一证据专项通过公开 check/verify/复验入口注入缺失、损坏、集合与身份故障，旧报告及其附加来源仍受校验。

开发原日志与原生 fixture 报告由运行记录保留在本次外部证据目录，详见协调者 run.json。定向结果：Vitest 适配器 21/21 通过；Playwright 20/20 通过；统一证据 27 项中原大组有 1 项受未完成安装缺少 tsx bin 影响失败，保留该失败原件，锁定安装有界恢复后对该项集中复验通过。公开 `npm run typecheck` 通过；公开 `test:logic` 16、`test:service` 4、`test:ui:core` 14 项均真实通过，UI 核心此次显式并发 2，零重试。原始报告和命令保留在运行记录的 `native-pilots/`，时长只是开发观察，不能拿来与不同 runner 的历史 CI 相减。本记录不声称固定候选正式通过。没有降低超时、减少用例、增加 retry 或复用历史成功取得速度。
