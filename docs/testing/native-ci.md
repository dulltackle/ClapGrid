# 当前检出的原生 CI（#199、#212）

`.github/workflows/check.yml` 在 GitHub Actions 本身的 checkout 执行 `npm ci`、`npm run typecheck`、`vitest run`、`playwright test` 和 `npm run build`，各自为独立步骤。没有第二个检出、旧 verify 或跨运行成功复用。`logs/source-commit.log` 保存实际 HEAD；PR 合并结果及手动 ref 以该运行 checkout 为准，不额外声明 main 提交已经重新测试。

运行环境保持 Ubuntu 24.04、锁定 Chrome 131.0.6778.204 和 Node 版本文件。入口为 PR 和手动执行，取消 main push 自动运行，原 concurrency 表达式保持不变。自动首次相同 workflow/event/ref 可替换，手动和 rerun 使用独立组。Vitest 默认使用 forks、文件并行及 `maxWorkers: '50%'`（本机 16 核为 8 workers，CI 4 vCPU 为 2 workers）；Playwright 使用 3 workers（依据见 [#215](https://github.com/dulltackle/ClapGrid/issues/215)），不增加机器或 shard。`process-trace.yml` 同样在每个 PR 和手动运行，承担真实 FFmpeg 正向及七个拒绝窗口的 strace 专项；全套逻辑中的同名业务用例与额外进程追踪是不同验证边界，不是统一套件重复运行。

Vitest 使用自身配置 `tests/**/*.test.ts`，Playwright 使用 `**/*.spec.ts`。现有原生配置 `retry/retries: 0`、`allowOnly: false`/`forbidOnly: true` 保持，Vitest `passWithNoTests: false`、Playwright 未启用 pass-with-no-tests；收集为空失败。没有迁移中临时 exclude 清单。稳定候选仍须执行全套检查与真实 CI，原生收集通过本身不等于完整产品验收。

## Vitest 并发选择（#212）

本地 `npm test` 与 CI 使用同一份 `vitest.config.ts`。`parallel` project 收集 `tests/**/*.test.ts`，排除 `bounded-run.test.ts`；`deadline` project 仅收集该文件，设置 `fileParallelism: false`，并以 `sequence.groupOrder: 1` 等待并行 project 结束。全套每个文件各收集一次。`pool: 'forks'`、`isolate: true`、零重试、禁止 `.only`、空收集失败和现有超时均保持。

`bounded-run` 在独立 Vitest 子进程中用 500ms 故障期限检查取消、命令超时和资源退出。首次 CI 2 workers 下，`refuse-term` 在业务初始化及命令清理期间先达到测试期限，报告变成测试超时而非预期的命令超时。该文件的目录、端口和进程已独立；继续调整资源命名不能消除 CPU 调度竞争，放宽期限又改变故障窗口，因此按规格只让该文件最后独占执行。其他文件继续并行。

首次 CI 4 workers 还出现真实媒体导出超过原有 15 秒期限，以及插件升级用例在停止服务后重新读取进程身份的竞态。后者改为等待停止前已经登记的出生身份，保留真实退出断言；前者保留原超时。4 workers 仅比 2 workers 快约 7 秒且出现更多失败，因此 workflow 不加 4 workers 覆盖。

## 合并门槛

main 的 GitHub 分支保护要求通过 PR 合并，`check` 与 `process-trace` 为 GitHub Actions 提供的必需检查，开启严格的分支同步要求并约束管理员。main 更新后，其他 PR 更新分支并重新通过检查；禁止强制推送和删除 main。这些保护须在取消 main 自动运行前生效。当前允许单人维护，未额外要求其他账号的审批；用户审核与合并授权按会话要求执行。

取消重复 main 检查不等于跨提交复用通过结果。合并后的独立验证可手动触发，发布安装包时仍验证实际发布产物。采用理由见 ADR0011。

## 原始报告与失败状态

- Vitest 步骤同时输出 default 控制台日志和原生 JSON `logs/vitest.json`；不转换为自研报告。
- Playwright 原生 reporter 同时输出 list、JSON `logs/playwright/ci/report.json` 和 HTML `logs/playwright/ci/report/`；失败 trace/screenshots 在 `logs/playwright/ci/results/`，HTML 附件一起上传。浏览器由原生 fixture 管理。CI 的 Playwright 步骤显式设置 `CLAPGRID_PLAYWRIGHT_RUN_DIR=logs/playwright/ci`，必需报告核对与 artifact 上传使用同一目录；命令日志 `logs/playwright.log` 和资源日志 `logs/playwright-resources.txt` 不变。
- 各检查的 stdout/stderr 与 `/usr/bin/time -v` 原始资源日志分别保存在 `logs/*.log` 与 `logs/*-resources.txt`；作业耗时以 GitHub job 记录为准。资源原件包含该命令的 maxRSS/CPU，不能冒充同时进程树总峰值；准备与安装仍计入作业时窗。它们不是结果认证，实际步骤结论以 Actions 为准。

Bash 显式 shell 使用 Actions 的 `-e -o pipefail`，`tee` 不吞没原生命令失败。检查步骤不设置 continue-on-error；失败后后续检查/构建保持 skipped。报告校验和上传使用 `always()`，并只在对应测试步骤实际启动（outcome 非空且非 skipped）时要求其报告。已启动但失败或取消的测试仍尝试保存结果，缺失必需 JSON/HTML 使独立校验失败；上传使用 `if-no-files-found: error`，上传错误也传播。未启动的 Playwright 不伪造报告或成功结果。平台强制终止可能中断附件上传，取消运行仍是取消，不能当作通过。

工件以 run_id/run_attempt 唯一命名，保留14天。通用日志始终尝试保存；失败截图/trace仅在框架实际产出时存在，不要求通过用例伪造失败附件。报告校验仅检查原生文件存在且非空，语义和状态由原生框架及 Actions 展示；未新增签名、身份校验或跨框架累计协议。

## 系统依赖的有界恢复（#240）

两个检查 workflow 调用 `scripts/ci/install-system-packages.sh <包...>`，各自只安装需要的包。脚本先执行 `apt-get update` 与 `apt-get install --download-only`，下载 `scripts/ci/system-packages.txt` 中的并集（ffmpeg、fontconfig、fonts-noto-cjk、strace），随后用 `--no-download` 安装调用方指定的包。两个检查和预热共用 `.cache/system-packages/*.deb`；精确缓存键由并集文件的 SHA-256、runner 的 `ImageOS`、`ImageVersion` 组成，不跨镜像版本模糊恢复，也不缓存 apt 索引或锁文件。

连接空闲超时无法发现仍在缓慢传输的下载；runner 的 `mirror+file` 也只在请求失败时切换。首次下载阶段有 90 秒外层期限，只有超时或明确网络错误才能恢复一次，第二次下载阶段最多 150 秒；依赖步骤仍以 5 分钟兜底。每次下载包含更新索引，使用 `APT::Update::Error-Mode=any`，避免部分索引失败被误判成功。apt 内部重试关闭。签名、哈希、包不存在、未知错误直接失败；这些错误与网络错误并存时优先判为不可恢复。安装阶段不下载、不重试；恢复后仍失败、产品测试失败照常传播。

恢复只调整 `/etc/apt/apt-mirrors.txt` 已有条目：把 azure 移到末尾并将其显式 `priority` 改为其余源之后的数字。仅移动文本行不会覆盖 runner 的 `priority:1`，因此必须同时调整该值。沿用 runner 自带的 archive/security 源、密钥和签名链，不添加第三方镜像。

PR 无法读取其他 PR 写入的缓存，而 main push 按 ADR0011 不重复运行检查，因此新增 `warm-system-packages.yml`，每周一 UTC 08:23 和手动触发，作业限制 main。它只下载并保存并集缓存，不安装、不执行检查。首次引入的分支手动验收需临时放开 main 限制，验收后撤回，不保留故障注入入口。

脚本支持 `CLAPGRID_APT_MIRRORLIST`、`CLAPGRID_APT_PRIMARY_SECONDS`、`CLAPGRID_APT_FALLBACK_SECONDS` 覆盖镜像文件和期限；`CLAPGRID_APT_CACHE_DIR`、`CLAPGRID_APT_LOG` 指定缓存和日志路径，`CLAPGRID_APT_CACHE_HIT` 记录 Actions 返回的命中状态。`--download-only` 用于预热。每次尝试记录镜像、UTC 起止、退出码、失败分类和实际次数，退出时向 `$GITHUB_STEP_SUMMARY` 追加一行摘要，区分首次通过和恢复通过。依赖失败时仍由 `always()` 上传日志；平台强制终止可能截断脚本的退出摘要，但此前日志仍尝试上传。
