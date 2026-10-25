# 原生 CI

接线以 `.github/workflows/check.yml`、`process-trace.yml`、`warm-system-packages.yml` 和 `vitest.config.ts`、`playwright.config.ts` 为准。本页只记录配置中看不出的原因与约束。

## 执行范围

两个检查 workflow 在 PR 和手动入口运行，main push 不重复运行（ADR0011）。结论只对应该运行实际检出的提交（`logs/source-commit.log`）；PR 合并结果及手动 ref 不表述为 main 提交已经重新测试，也不跨运行复用成功结论。`process-trace` 的 strace 专项与全套中同名业务用例是不同验证边界，不是重复运行。原生收集通过本身不等于完整产品验收。

## 并发选择

Vitest 使用 50% workers（CI 4 vCPU 为 2 workers），Playwright 使用 3 workers（[#215](https://github.com/dulltackle/ClapGrid/issues/215)），不增加机器或 shard。

`bounded-run.test.ts` 用 500ms 故障期限检查取消、命令超时和资源退出。并行时 CPU 调度竞争会让测试期限先于预期的命令超时到达；调整资源命名无法消除，放宽期限又改变故障窗口，因此该文件单独作为 `deadline` project 在其他文件结束后独占执行（[#212](https://github.com/dulltackle/ClapGrid/issues/212)）。

CI 4 workers 仅比 2 workers 快约 7 秒，却出现真实媒体导出超出期限等更多失败，因此 workflow 不加 4 workers 覆盖。

## 合并门槛

main 的 GitHub 分支保护要求通过 PR 合并，`check` 与 `process-trace` 为必需检查，开启严格的分支同步要求并约束管理员；禁止强制推送和删除 main。这些保护须在取消 main 自动运行前生效。当前允许单人维护，未要求其他账号审批；用户审核与合并授权按会话要求执行。合并后的独立验证可手动触发，发布安装包时仍验证实际发布产物。

## 报告与失败状态

- 报告使用框架原生格式（Vitest JSON、Playwright JSON/HTML 与失败 trace/截图），不转换为自研报告，也不新增签名或跨框架累计协议。报告校验只检查必需文件存在且非空，语义和状态以原生框架及 Actions 为准。
- `/usr/bin/time -v` 资源日志的 maxRSS 是单进程最大观测值，不是进程树同时总峰值；作业耗时以 GitHub job 记录为准。
- 检查步骤不设 continue-on-error，`tee` 不吞没失败。已启动但失败或取消的测试仍尝试保存结果，缺失必需报告使校验失败；未启动的测试不伪造报告。取消运行仍是取消，不能当作通过。

## 系统依赖的有界恢复（#240）

`scripts/ci/install-system-packages.sh` 先下载 `scripts/ci/system-packages.txt` 的并集，再用 `--no-download` 安装调用方需要的包；缓存键包含并集摘要与 runner 镜像版本，不跨镜像模糊恢复。

连接空闲超时无法发现缓慢传输，runner 的 `mirror+file` 也只在请求失败时切换，所以下载阶段设外层期限，只有超时或明确网络错误才换源恢复一次；签名、哈希、包不存在和未知错误直接失败。换源时仅移动 azure 文本行不会覆盖 runner 的 `priority:1`，必须同时调整其 `priority`。沿用 runner 自带的源与签名链，不添加第三方镜像。

PR 无法读取其他 PR 写入的缓存，而 main push 不运行检查，因此 `warm-system-packages.yml` 每周在 main 预热并集缓存。首次引入的分支手动验收需临时放开 main 限制，验收后撤回，不保留故障注入入口。
