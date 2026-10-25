# 检查与验收

采用 [ADR0011：直接使用 Vitest 和 Playwright](../adr/0011-native-test-frameworks.md)。工具定位、GitHub 查询和长日志处理见[工具指引](tooling.md)。

文档新增、移动与整理遵循[文档维护约定](documentation.md)，由 [docs-commands 契约测试](../../tests/docs-commands.test.ts)随 `npm test` 与 CI 校验。

## 开发检查

使用仓库声明的 Node 版本与锁定依赖，并准备实际测试需要的浏览器、FFmpeg/ffprobe、Fontconfig 和中文字体。检查使用夹具和本地服务，不传入真实供应商凭据或发起收费调用；环境准备与失败记录按[工具指引](tooling.md)留存。

直接使用 Vitest 运行逻辑与服务测试，使用 Playwright 运行浏览器测试；过滤、watch 和调试使用框架原生 CLI。按变更执行定向测试及必要类型检查、构建。非导入资源、外部程序或配置变化需显式扩大范围，不能假定相关选测覆盖所有依赖。样式和 UI 变更同时实际核对面板。

当前命令定义以 [`package.json`](../../package.json) 为准。常用入口：

```bash
npm test                                      # Vitest 全套逻辑与服务测试
npm exec vitest -- run tests/business.test.ts   # 定向业务测试
npm exec vitest -- --watch tests/project-editing.test.ts
npm run test:ui                                # Playwright 全套浏览器测试
npm exec playwright -- test tests/editing.spec.ts --debug
npm run check                                  # 类型检查、两套原生测试与生产构建
```

Playwright 每轮默认分配 `logs/playwright/<UTC 时间戳>-<pid>/`，`results/`、`report/` 与 `report.json` 同属该轮，主进程将目录写回 `CLAPGRID_PLAYWRIGHT_RUN_DIR` 供 worker 继承。可显式指定该变量；已有非空目录会在测试前拒绝使用，换名后重跑。Vitest 目录策略不变。本地命令日志、进程组续跑与手动清理见[工具指引](tooling.md#playwright-运行目录与中断续跑)。

定向样式检查使用 `npm exec vitest -- run tests/style-collisions.test.ts`，并按实际改动选择 Playwright 场景。本地允许未提交内容，中断后可重跑，结论限于实际执行范围；取消和未执行不能算通过。

## 验收原件与手动收尾

“验收原件”是流程术语，指一次性检查或验收产生的截图、命令输出、运行日志、`acceptance.json`、原生测试报告与临时运行目录等，不进入产品领域词汇表。产品项目内的审阅证据、交付包成员、当前 `clapgrid/` 项目数据、仍在使用的制作项目、设计源文件与测试夹具不在此清理范围内。

按 [ADR0013](../adr/0013-local-evidence-lifecycle.md)，GitHub Issue/PR 评论是唯一权威持久记录，写明固定提交、环境、命令、实际结果和未验证项；仅争议结论或不可复现结果附关键原始文件，上传前先脱敏。本机原件只在任务活跃期保留，存放于本轮运行目录，如 `logs/playwright/<run>`、acceptance 运行目录或 `/tmp`；不再新建 `docs/validation/` 归档，也不保留 `docs/productions/`、`docs/design/` 的历史本机副本。

Issue 关闭或 PR 合并且摘要写入后，依次手动收尾：

1. 在对应 Issue/PR 评论记录摘要，核对提交、执行范围、结果与未验证项；必要附件已脱敏并上传。
2. 按[工具指引](tooling.md#playwright-运行目录与中断续跑)核对本轮目录归属、进程组已退出、服务与媒体资源已释放，且目录没有活跃任务或其他依赖；归属或状态不明时保留现场，先查明再清理。
3. 按已核对的精确路径手动删除本轮验收目录及日志，包括 `acceptance.json`；保留产品数据和上述排除项。不按固定天数清理，不自动轮换或删除运行中目录，不编写自动删除脚本或新增自动清理测试。

本政策只约束今后的本机文件；旧提交、既有 GitHub 附件与已关闭事项的历史记录保持原样。历史原件通过固定提交链接追溯，历史结论不能证明当前候选通过。

## 测试保障

框架负责收集、调度、隔离、浏览器生命周期、等待、清理和报告；产品 fixture/helper 接入原生生命周期。按独立故障保留、合并或删除测试，并说明仍有意义的产品保障由何处承接。

口播片段编辑、配音、素材、成片、数据完整性、产品兼容及必要资源清理继续受测。必要边界实际运行 HTTP/SQLite、浏览器和媒体进程；配置保持零重试、禁止 `.only`、零收集失败，必要 UI 不用跳过代替通过。资源清理只作用于本次拥有的产品资源。

## CI 完整验收

CI 在自身检出的提交上安装锁定依赖，执行类型检查、全套保留测试和生产构建。以 CI 提交、步骤状态、原生报告及失败附件为依据；失败须传播，必需报告保存失败须可见。真实 CI 未运行时明确待验，本地通过不能替代。

每个 PR 全量执行 `check` 与 `process-trace`，保留手动入口；main push 不自动重复执行。此流程要求 GitHub 分支保护生效：main 必须通过 PR 合并，两项必需检查均由 GitHub Actions 提供并通过，分支合并前与最新 main 同步，管理员同样受约束，禁止强制推送和删除 main。main 前进后，其他 PR 须更新分支并重新检查；保护未生效时不得依赖该流程。

PR 合并结果和手动 ref 的结论分别对应实际检出，不跨运行复用成功结论，也不把 PR 通过表述成 main 提交重新测试通过。保留自动事件去重策略，手动和重跑独立；必要专项仍在合并前执行。发布安装包时针对实际产物独立验证，安装包及实际宿主状态按[插件交付](plugin-delivery.md)分别验证。

执行接线、环境配置与报告位置见[原生 CI 说明](../testing/native-ci.md)，实际触发事件与步骤以[主检查 workflow](../../.github/workflows/check.yml)和[进程追踪 workflow](../../.github/workflows/process-trace.yml)为准。

## 性能与历史参考

性能结论注明实际源码、范围、工具、环境、缓存和配置，计入准备、安装、执行、报告保存与清理，披露 runner 总占用和资源成本。单轮结果只描述观察，不能推断波动或稳定改善。

测试迁移范围、旧机制退出及 #192 一次性性能验收约定见 [ADR0011](../adr/0011-native-test-frameworks.md)，旧机制退出与保障承接清单见 [#200](https://github.com/dulltackle/ClapGrid/issues/200)。这些历史约定不自动成为新任务的测量轮次要求。旧验证协议可查提交 `2f6fa2a` 中的 `docs/agents/verification-protocols.md`，仅用于理解历史证据。历史通过记录不能作为新候选的执行结果。

旧测试命令、参数、报告与后台验收协议已退出，不提供兼容入口。产品制作的 `evidence` / `verify-package` 和插件 `plugin:verify` 仍按[制作命令](../production.md)及[插件交付](plugin-delivery.md)使用。

## 持续交互验收入口

使用 `npm run acceptance -- --grep '空项目$'` 或 `npm run acceptance -- --grep '真实成片已导出$'`，默认选择空项目，每轮只允许一个场景；宽泛筛选选中多场景时，后续场景在创建现场前报错。独立配置只收集 `tests/acceptance/**/*.acceptance.ts`，不启动 Playwright 浏览器；`test:ui` 和 CI 的浏览器阶段不收集这些文件。CI 的 Vitest 进程测试仍验证空项目的信号停止、到期停止与资源清理。

场景通过 API 准备；“真实成片已导出”使用受控配音供应商及真实 `submitExport` 渲染。项目只在本轮新建的临时目录中，服务只监听 `127.0.0.1`，没有用户项目路径或真实供应商选项。场景准备完成后，原子写入运行目录下的 `acceptance.json` 并在 stdout 输出路径，文件存在即就绪。默认每个场景存活 30 分钟，`CLAPGRID_ACCEPTANCE_MAX_MINUTES` 可设为有限正数（支持小数，无人为上限）；从验收 fixture 初始化起计时，到期正常 teardown、退出 0。启动、查询和停止步骤见 [工具指引](tooling.md#持续交互验收的启动查询与停止)。

实际浏览器验收清单：

1. 在实际连接的浏览器中读取并记录 `navigator.userAgent`，以及 `document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"')`、`canPlayType('video/webm; codecs="vp8"')`。记录观察时间、浏览器名称和三项原始结果；不能用另起的 Playwright 浏览器代替。
2. 按探测结果选择成片或兼容预览路径。打开面板的任务记录，核对真实导出成功和成片链接；观察播放、时长、`currentTime` 推进与媒体错误，记录实际结果。编码不支持时记录能力限制，不靠改测试源码延长现场。
3. 记录本轮 `acceptance.json`、源码提交与 dirty 状态、面板构建身份、服务实例及截图。停止后核对 JSON 的停止原因与 `cleanup`，确认端口关闭、临时项目删除。`SIGINT` 可由 Playwright 报为 interrupted；到期退出必须成功。

入口固定标注 `evidenceScope: candidate-source-service`，只证明候选源码服务及其独立面板。`candidate-panel` 身份的指纹对应这轮面板构建，不是完整插件包身份。它不能作为 `plugin:verify` 所需的实际 MCP 宿主或面板证据；源码、安装包和实际插件宿主仍按[插件交付](plugin-delivery.md)分别报告。此入口不探测浏览器、不新增产品探测端点、不修改成片或兼容预览契约。
