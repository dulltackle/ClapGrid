# 当前检出的原生 CI（#199）

`.github/workflows/check.yml` 在 GitHub Actions 本身的 checkout 执行 `npm ci`、`npm run typecheck`、`vitest run`、`playwright test` 和 `npm run build`，各自为独立步骤。没有第二个检出、旧 verify 或跨运行成功复用。`logs/source-commit.log` 保存实际 HEAD；PR 合并结果、main 提交、手动 ref 以该运行 checkout 为准。

Ubuntu 24.04、锁定 Chrome 131.0.6778.204、Node 版本文件、PR/main/manual 入口和原 concurrency 表达式保持不变。自动首次相同 workflow/event/ref 可替换，手动和 rerun 使用独立组。全套框架保留现有原生并发（Vitest 1 fork、Playwright 2 workers），不增加机器或 shard。`process-trace.yml` 仍在每个 PR、main push 和手动运行，承担真实 FFmpeg 正向及七个拒绝窗口的 strace 专项；全套逻辑中的同名业务用例与额外进程追踪是不同验证边界，不是统一套件重复运行。

Vitest 使用自身配置 `tests/**/*.test.ts`，Playwright 使用 `**/*.spec.ts`。现有原生配置 `retry/retries: 0`、`allowOnly: false`/`forbidOnly: true` 保持，Vitest `passWithNoTests: false`、Playwright 未启用 pass-with-no-tests；收集为空失败。没有迁移中临时 exclude 清单。#200 删除仍留在该命名空间内的旧工具专属测试后，稳定候选才执行全部收集与承接说明核对和真实 CI；本票阶段不把迁移中全量收集声称为完整产品验收。

## 原始报告与失败状态

- Vitest 步骤同时输出 default 控制台日志和原生 JSON `logs/vitest.json`；不转换为自研报告。
- Playwright 原生 reporter 同时输出 list、JSON `logs/playwright.json` 和 HTML `logs/playwright-report/`；失败 trace/screenshots 在 `logs/playwright-results/`，HTML 附件一起上传。浏览器由原生 fixture 管理。
- 各检查的 stdout/stderr 与 `/usr/bin/time -v` 原始资源日志分别保存在 `logs/*.log` 与 `logs/*-resources.txt`；`ci-observation.mjs` 沿用现有作业耗时观察。资源原件包含该命令的 maxRSS/CPU，不能冒充同时进程树总峰值；准备与安装仍计入作业时窗。它们不是结果认证，实际步骤结论以 Actions 为准。

Bash 显式 shell 使用 Actions 的 `-e -o pipefail`，`tee` 不吞没原生命令失败。检查步骤不设置 continue-on-error；失败后后续检查/构建保持 skipped。报告校验和上传使用 `always()`，并只在对应测试步骤实际启动（outcome 非空且非 skipped）时要求其报告。已启动但失败或取消的测试仍尝试保存结果，缺失必需 JSON/HTML 使独立校验失败；上传使用 `if-no-files-found: error`，上传错误也传播。未启动的 Playwright 不伪造报告或成功结果。平台强制终止可能中断附件上传，取消运行仍是取消，不能当作通过。

工件以 run_id/run_attempt 唯一命名，保留14天。通用日志始终尝试保存；失败截图/trace仅在框架实际产出时存在，不要求通过用例伪造失败附件。报告校验仅检查原生文件存在且非空，语义和状态由原生框架及 Actions 展示；未新增签名、身份校验或跨框架累计协议。

## 阶段验收

本票只验证 YAML/bash 接线、定向原生 reporter 和必要类型检查，不触发远端运行。完整保留套件、制作归档/插件兼容及专项的收集一致性，以及真实 Actions 步骤和 artifact 上传失败传播，待 #200 后稳定候选实际运行，未执行子句保持待验。源码测试接线不更新插件安装包或实际宿主。性能仍按用户确认前后各1轮报告实际观察，不把开发定向检查当成性能样本。
