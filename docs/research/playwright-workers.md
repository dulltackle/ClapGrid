# Playwright 并发选择（#215）

2026-10-22 按 [#215](https://github.com/dulltackle/ClapGrid/issues/215) 最新规格从第 2 步开始。第 1 步已由事项结案：此前本机全套、绑定用例重复和降速均未复现，原失败附件无法找回；环境变量线索经源码分析排除。本次三档 CI 中工作空间绑定面板用例均通过，未触发重开第 1 步；不把未复现称为已修复。

## 三档单轮 CI

依次通过现有 `check.yml` 的 `workflow_dispatch` 运行完整检查，不修改工作流、runner 规格、浏览器、断言、超时或重试。共同源码起点为 `c330409d01d29f3e795faf69056a99639cf1a3b5`；3、4-worker 临时分支分别只修改 `playwright.config.ts` 的 `workers` 一行。各轮使用独立的 Ubuntu 24.04 GitHub 托管 runner（相同规格，不是同一物理机器），没有分片或新增 job。Node 22.23.4、npm 10.9.9、Chrome for Testing 131.0.6778.204、FFmpeg/ffprobe 6.1.1、Playwright 1.64.1 和锁定 npm 依赖保持一致；沿用现有安装和缓存策略，没有人为预热或清缓存。

| workers | 实际检出提交 | Actions 运行 | Playwright 原生墙钟 | GNU time 墙钟 | 完整 job / runner 占用 | 排队及启动等待 | maxRSS（KiB） | user + system CPU（s） | 浏览器结果 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 2 | `c330409d01d29f3e795faf69056a99639cf1a3b5` | [39778881119](https://github.com/dulltackle/ClapGrid/actions/runs/39778881119) | 214.50s | 215.35s | 764s | 4s | 768432 | 204.40 + 54.34 | 167 全通过 |
| 3 | `dafbf58eff432a74d90bd73d55eedfd9c8d28313` | [39780804463](https://github.com/dulltackle/ClapGrid/actions/runs/39780804463) | 165.01s | 165.54s | 421s | 3s | 747316 | 191.37 + 48.31 | 167 全通过 |
| 4 | `922c57e162545519ceab77abfa68f2e07c7b7e76` | [39781846852](https://github.com/dulltackle/ClapGrid/actions/runs/39781846852) | 219.02s | 219.90s | 546s | 3s | 742680 | 260.27 + 70.02 | 167 全通过 |

三轮完整 job 均成功，均为 65 个 Vitest 文件、664 例通过，以及 167 例 Playwright 通过；浏览器零失败、零跳过、零 flaky。报告校验及上传成功，原生 JSON/HTML 和实际生成的失败附件仍沿用工作流保留策略；通过轮次没有伪造失败截图或 trace。

采纳 **3 workers**，本地与 CI 共用配置，`fullyParallel: false`、`retries: 0`、`forbidOnly: true` 保持。该档浏览器原生墙钟比 2-worker 少 49.49s（23.1%），完整 job 占用少 343s；4-worker 比 3-worker 慢 54.01s，未采纳。每次测量仅一个 `check` job，总 runner 占用等于其完整 job 时长，包含准备、安装、测试、构建、上传及清理；不含排队等待。此次测量不重复运行未修改的 `process-trace` 专项，也不声称取得完整 PR merge-ref 检查结论。

整轮差值不能全归因于 worker 调整：2/3/4 档系统依赖准备分别为 260/22/20s，Vitest 分别为 258/203/279s；其中相同 155 MB 系统包下载在基线用了 4min 6s，3/4 档分别为 6s/5s；其他阶段也有差异。只报告这些单轮实际观察，不估计中位数、波动或宣称稳定提速。GNU time maxRSS 是入口及后代的单进程最大观测值，不是并发进程树同时总峰值；CPU 时间包含嵌套构建、Chrome、真实服务和媒体子进程的成本。三档测量本身累计消耗 1731 runner 秒，单列实验成本，不当作日常检查的节省。

## 整轮共享面板构建

选择提高并发后，使用 Playwright `globalSetup` 为本轮创建唯一临时目录并完成普通面板生产构建，再通过环境变量把路径传给 worker。普通 worker 只读使用该产物；Playwright 在 worker 退出后调用返回的清理函数，恢复原环境变量并删除本轮目录；构建失败也清理目录。并行的另一轮有独立目录，不扫描或删除其他运行的资源。

受控身份的刷新 fixture 仍通过 `panelBuildIdentity` 走独立构建和原有清理，普通产物不被覆盖。没有引入额外缓存、报告认证或调度协议；按规格不新增实现细节测试，以既有真实 HTTP/SQLite、浏览器与媒体用例验收。

## 最终实现验证

最终实现快照 `5e851ba3302d101efa15915aaf32e4ee56f63e8c` 在 [39783396296 / attempt 2](https://github.com/dulltackle/ClapGrid/actions/runs/39783396296/attempts/2) 完整通过：664 例 Vitest、167 例 Playwright，浏览器零失败、零跳过、零 flaky，类型检查、生产构建、报告校验和上传均成功。该快照三份配置/实现文件与交付内容字节一致，后续补充的测量文档不在此 CI 快照内；它不是最终本地提交或 PR merge-ref 的重新验收。

共享构建版本的浏览器原生墙钟为 202.12s，GNU time 墙钟 202.96s，CPU 229.43 + 56.40s，maxRSS 754312 KiB；完整 job / runner 占用 512s，低于基线 764s，本次 attempt 的排队及启动等待为 4s。系统依赖准备 19s、Vitest 256s。该轮浏览器时间没有短于调参轮的 165.01s，不宣称共享构建带来额外实测提速，也不将独立 runner 单轮差值解释成稳定回归。

首次 attempt 在系统包下载阶段长期停留，日志多次出现 `Ign`、最后停在 `libavcodec60` 下载；测试未启动，主代理取消以释放 runner 并取得日志。该次 job 消耗 920s，结论为 cancelled，不算通过；同提交及同工作流重跑后才取得上面的通过记录。三档测量 1731s、取消 920s、最终验证 512s，合计实际实验占用 3163 runner 秒；这些一次性实验成本没有混入日常检查的节省。

本地使用 Node 22.23.4 和完整 Chrome 131，最终 `npm run check` 通过类型检查、65 个文件及 664 例 Vitest、167 例 Playwright 和生产构建；另有工作空间绑定、面板刷新和项目生命周期 15 例定向检查通过。整轮结束后未发现本轮共享面板目录残留。独立只读审查覆盖全部 5 份变更文件，未发现可行动问题。本次按事项范围仅交付源码和 CI 证据，不执行插件安装或实际宿主验收。

原始证据在各 Actions 运行的 artifacts；本机副本与续接记录位于 `/home/forclaw/tmp/clapgrid-215-ci/`。本机路径不是远端可下载附件。
