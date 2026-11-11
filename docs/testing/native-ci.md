# 原生 CI

接线以 `.github/workflows/check.yml`、`process-trace.yml`、`test-image.yml`、`.github/actions/test-environment/action.yml` 和 `vitest.config.ts`、`playwright.config.ts` 为准。本页只记录配置中看不出的原因与约束。

## 执行范围

两个检查 workflow 在 PR 和手动入口运行，main push 不重复运行（ADR0011）。结论只对应该运行实际检出的提交（`logs/source-commit.log`）；PR 合并结果及手动 ref 不表述为 main 提交已经重新测试，也不跨运行复用成功结论。`process-trace` 的 strace 专项与全套中同名业务用例是不同验证边界，不是重复运行。原生收集通过本身不等于完整产品验收。

## 并发选择

`check.yml` 把类型检查与生产构建、Vitest 3 个分片、Playwright 2 个分片拆为并行 job；汇总 job 保持 `check` 名称供分支保护使用（[ADR0017](../adr/0017-parallel-ci-jobs.md)）。两套测试和进程追踪使用同一个镜像和 `test-environment` composite action。类型检查与生产构建在宿主 runner 上运行，无需媒体环境。

分片使用框架原生 `--shard`，按文件路径哈希均分文件数，各片负载不均；不按历史耗时自建分配。各 job 内 Vitest 使用 50% workers（CI 4 vCPU 为 2 workers），Playwright 使用 3 workers（[#215](https://github.com/dulltackle/ClapGrid/issues/215)）。

`bounded-run.test.ts` 检查测试取消、命令超时和资源退出。依赖 Vitest 超时触发的夹具保留各自的故障期限；命令超时夹具由命令自己的期限触发，外层测试期限还须容纳 TERM 等待和 KILL 退出确认。该文件单独作为 `deadline` project，在同一分片的其他文件结束后独占执行，减少 CPU 调度竞争（[#212](https://github.com/dulltackle/ClapGrid/issues/212)）。

CI 4 workers 仅比 2 workers 快约 7 秒，却出现真实媒体导出超出期限等更多失败，因此 workflow 不加 4 workers 覆盖。

## 合并门槛

main 的 GitHub 分支保护要求通过 PR 合并，`check` 与 `process-trace` 为必需检查，开启严格的分支同步要求并约束管理员；禁止强制推送和删除 main。这些保护须在取消 main 自动运行前生效。当前允许单人维护，未要求其他账号审批；用户审核与合并授权按会话要求执行。合并后的独立验证可手动触发，发布安装包时仍验证实际发布产物。

## 报告与失败状态

- 报告使用框架原生格式（Vitest JSON、Playwright JSON/HTML 与失败 trace/截图），不转换为自研报告，也不新增签名或跨框架累计协议。Vitest 与 Playwright 每个分片各自保存报告，不合并。报告校验只检查必需文件存在且非空，语义和状态以原生框架及 Actions 为准。
- `/usr/bin/time -v` 资源日志的 maxRSS 是单进程最大观测值，不是进程树同时总峰值；作业耗时以 GitHub job 记录为准。
- 检查步骤不设 continue-on-error，`tee` 不吞没失败。汇总 job `check` 在任一阶段失败、取消或跳过时失败。已启动但失败或取消的测试仍尝试保存结果，缺失必需报告使校验失败；未启动的测试不伪造报告。取消运行仍是取消，不能当作通过。

## 测试镜像

[Dockerfile](../../scripts/ci/test-image/Dockerfile) 以固定摘要的 Ubuntu 24.04 Playwright 官方镜像为基础，加入 Node、Chrome for Testing、FFmpeg/ffprobe、Fontconfig、Noto CJK 与 strace。Playwright 基础镜像版本与 `package-lock.json` 中的 `playwright-core` 一致，Node 版本与 `.node-version` 一致。面板继续使用固定版本的 Chrome for Testing，页面渲染继续使用锁文件对应的 Chromium Headless Shell。

只有构建镜像时访问 Ubuntu 软件源。检查作业按摘要从 GHCR 拉取镜像，使用只读包权限；在当前源码上运行 `npm ci`，并试启动镜像里的渲染浏览器。Vitest 以与托管 runner 工作区 UID 一致的普通用户运行，以保留只读文件等权限断言。只有 `process-trace` 作业授予 `SYS_PTRACE`，它仍执行真实进程追踪与 FFmpeg 正向对照。

升级依赖时，先更新 Dockerfile 中对应的版本和摘要。将镜像定义推到仓库内 `ci-image/` 分支以构建，或从 `main` 手动运行[镜像发布工作流](../../.github/workflows/test-image.yml)。构建通过浏览器、媒体工具、字体和 strace 检查后发布；用运行摘要给出的 `ghcr.io/…@sha256:…` 同步替换两个检查工作流里的镜像引用。最后在 PR 的同一候选提交确认 `check` 与 `process-trace` 均通过。PR 本身不构建或写入注册表。
