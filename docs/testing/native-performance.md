# 原生测试迁移的单轮对照方法

#201 采用用户于 2026-10-20 确认的改前、改后各 1 轮约定，取代原三轮及排除波动要求。报告实际变化，不计算多轮中位数，不将观察到的差值称为稳定提速。实际结果与原始日志保存在本轮仓库外运行记录及 GitHub 事项中，分别绑定实际源码提交；本页只固定测量方法。

## 范围与执行顺序

改前源码为 `6d1dc8eee0057738ecb271d8a204629486ea9efa`，已包含 PR #191。依次运行逻辑/服务、口播片段 UI、测试配置变更后的完整检查；改后在独立集成审查通过的干净固定候选上保持顺序。

| 场景 | 改前入口 | 改后入口及范围差异 |
| --- | --- | --- |
| 逻辑/服务 | 旧 test-runner，project-editing/modification/service 三文件 | Vitest 直接运行相同三文件及18条产品测试 |
| 口播片段 UI | 旧 test-runner，editing-panel/paste-panel/relative-insert-panel | Playwright 直接运行 editing/paste/insert 三个 spec；承接相同目的，扩大真实 HTTP/SQLite、虚拟表格与竞态场景；详见 native-editing.md |
| 测试配置变化 | npm run check 完整旧链 | npm run check 完整原生链，包含类型检查、全部保留产品测试与生产构建；退出的工具专测及保障承接详见 native-retirement.md |

本地使用既有实体锁定依赖及现存缓存，不清缓存或预热来制造差值。记录机器、Node/npm/Chrome/FFmpeg/ffprobe 与框架版本、关键技术环境变量和配置原件。Vitest 1 fork、Playwright 2 workers、零重试；开发过程定向迭代不冒充额外性能样本。工具版本、执行范围或环境差异均随结果披露。

## 时间和资源口径

本地以 monotonic wall time 包围真实入口，GNU time -v 保存 CPU、最大 RSS、上下文切换及文件系统成本；入口内 fixture 准备、标准构建、报告保存与清理均计时。已安装依赖准备不重复记为每次开发入口耗时，单列环境；入口之外的证据复制归档另记。最大 RSS 是 GNU time 的观测口径，不等于同时运行进程树的总峰值，不能冒称全树峰值；嵌套媒体和浏览器进程成本结合 CPU、实际命令与 CI 步骤解释。

CI 对照完整检查 workflow 加 process-trace 专项，两者都在相同 Ubuntu 24.04 runner 规格、锁定 Chrome 131 与 Node 版本上运行。每个 job 包含 checkout、工具和锁定依赖安装、执行、报告与清理；分别报告步骤时间、完整 job 时间、排队等待和全部 job 时长之和（总 runner 占用）。相同规格不表示同一物理机器。不增加机器、分片或并发来制造收益，总 runner 占用不增加仍是验收条件。这里的“不增加并发”仅用于 #201 迁移前后对照，不是长期并发上限；#212 按 ADR0011 在同一 runner 规格内独立测量 Vitest 文件并行，仍核对总 runner 占用。

基线两个实际 workflow_dispatch 运行分别为 `39386840086`、`39386898418`，合计 runner 占用2231秒。改后也运行同一 workflow 的手动入口，记录实际 ref/head SHA；该入口与 PR 使用相同完整检查步骤，但不是 PR merge-ref 或 main push 的运行证据。没有发生的 main 运行明确待验。基线 CI 未采集峰值内存，报告 unknown，不拿本地 RSS 填充 CI 数据或重复基线补造可比性。

## 结果与验收

逐场景列出原始耗时、绝对及相对差值和资源成本，保留失败、取消与局部回退。单轮没有改善时照实报告。最终候选全套真实 CI、独立产品保障审查与旧机制退出核对分别提供证据；测量结果不替代测试成功。源码提交、安装包与实际宿主分别报告，本轮不安装插件、不更新实际宿主、不自动发布。
