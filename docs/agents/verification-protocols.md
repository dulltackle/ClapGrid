# 检查与正式验收

`npm run check` 检查当前开发目录，允许未提交内容。日志位于 `logs/check/`，记录完整 Git 提交/tree、代码检查输入的版本化内容身份、检查阶段和结果。发现阶段间受检输入变化时返回非零并标为 `invalidated`；起止一致不能证明运行期间从未修改。

## 代码检查输入

`scripts/source-identity.json` 的 schema 2 显式选择 `code-check-v1`。统一读取 Git 跟踪文件与未忽略新文件，仅排除 `docs/productions/`、`docs/validation/`、`docs/design/` 的历史内容（包括其 Markdown 说明）。代码、配置、检查工具、真实资源、全部 `tests/fixtures/`、`docs/templates/` 及未知路径均保留完整当前内容校验。代码新增历史材料依赖时，先将所需材料迁入受检资源/fixture，不能将排除目录作为隐藏输入。

源码指纹、选测的当前/基准依赖图、watch 事件与周期探测共用此边界。报告列出 `scope`，选测另列 `excludedChanges`；排除材料修改不触发执行，也不产生测试通过证据。源码身份的 `dirty` 仅说明受检输入是否偏离提交，不能用它宣称整个仓库干净。无配置和 schema 1 的旧目标继续原全仓库协议；未知版本拒绝，不迁移或复用旧范围的通过结果。

历史非 Markdown 原件退出当前 Git 跟踪并保留迁移时的本机文件；旧提交保留，恢复方法见 [历史制作工程](../productions/README.md) 与 [历史验收记录](../validation/README.md)。这不改变制作命令对显式项目输入的校验，也不将代码检查结论扩展为制作材料验收。决定见 [ADR0010](../adr/0010-code-check-input-boundary.md)。

## 运行与取消

同一真实工作树路径的 `check`、`verify`、`check:ui`、`check:preflight` 和 `check:failed` 共用一把运行锁。正式验收的同身份请求连接已有任务，不再次执行；其他重复启动拒绝并显示运行身份，不同工作树独立。启动器先预约锁，后台 worker 凭同一令牌接管，避免启动窗口漏过互斥。

用 `npm run check:stop` 或 `npm run verify -- cancel --run <runId>` 显式取消。停止命令通过带运行令牌的本地控制通道交给实际执行者，核对登记的全部进程组，不依赖调用者可见的 PID。嵌套任务保留全部祖先检查身份及登记范围，父检查取消也覆盖其启动的独立后台 worker。只有本次拥有的子进程组退出后才释放锁；取消记录为 `cancelled`，退出 130，不计成功，也不继续后续阶段。旧 runId 不能取消另一任务。

普通开发检查收到 SIGINT/SIGTERM 会取消；正式验收的启动／等待终端只是观察者，退出不会取消独立 worker。拥有者异常退出后保留锁和日志；只有核对命名空间、进程出生身份及全部登记进程组已结束，才能标记 interrupted，并通过生命周期清理入口重试同身份验收。其他残留用停止入口处理；跨命名空间且控制通道不可达时保留锁并报错，不能仅根据本地 PID 不存在、心跳过期或外层命令退出码判断已停止。

Linux 对已绑定的本命名空间登记组先用原生负 PGID 查询确认整组不存在，只有 ESRCH 可以省去外部扫描；组仍可见时继续完整扫描和僵尸过滤，未知错误保留锁。测量与保留边界见 [生命周期切片](../research/lifecycle-170/README.md)。

Linux/macOS 用独立进程组管理普通子孙进程，宽限期后对尚未退出者强制停止；不扫描或按命令名终止其他工作树及应用服务。主动脱离进程组的外部守护进程不属于此机制的保证范围。Windows 使用 taskkill 进程树终止分支；正式回归以 Ubuntu CI 为准，未在 Windows/macOS 执行的结果不能宣称已验证。

## UI 迭代

纯静态样式和布局调整先执行 `npm run check:ui`，再打开实际面板核对。默认扩展集包含点击范围、表格控件、双层行、说明展开、配音状态、宽窄屏、长文案和悬浮；固定核心包含已有的 24px 点击范围检查。组件映射由 `scripts/ui-check-plan.mjs` 维护。

- `npm run check:ui -- --plan --base <提交>` 只查看范围及升级原因。
- `npm run check:ui -- --base <提交>` 运行类型、真实浏览器用例及构建，日志位于 `logs/check-ui/`。
- `--scope row` 选择固定核心；`--concurrency 1|2` 仅对已确认隔离的 UI 文件启用有限并发，安全范围默认 2，扩展到其他用例时保守回到 1，不改变全套测试并发。

默认 `--base HEAD` 比较工作区；检查已提交的修改时须指定修改前的提交。静态 className 字面量和未改变导入／扫描规则的 CSS 可判为样式变化。

`src/panel/app.tsx` 中从 `ag-grid-community` 导入的 `themeQuartz.withParams` 顶层 `const theme` 配置，也允许已有颜色白名单字段的静态字符串值替换（含 `var(...)`、`color-mix(...)` 和无插值模板字符串）；白名单由 `scripts/ui-check-plan.mjs` 维护，其余源码须仅有已认可的静态样式变化。主题颜色调整仍执行全部面板浏览器测试、类型检查和构建。新增／删除字段、动态表达式、展开或计算属性，以及字号、尺寸、间距等其他配置变更均升级；事件、保存、编辑、请求、协议、依赖和检查工具变更仍需完整检查。

UI 快检共享生命周期的互斥与取消，使用已确认的 UI 检查边界，不重复插入完整检查的强制预检。退出 0 且 `completeForLocalUi:true` 才通过本机 UI 快检；非样式变化即使用例通过也返回 2、`requires-full-check`。缺失 Chrome、未实际执行、跳过、取消或 todo 均不能假绿；`--scope row` 不能绕过升级。

UI 测试同时保存 TAP 和原生事件 JSON；失败文件写入同一失败待办，供后续完整检查集中复验。快检通过和失败复验通过均不代替完整验收。

辅助工具记录 bundle、CSS、Chrome 启动、交互和清理耗时；跨进程按实际输入与依赖指纹复用构建，各场景仍使用独立浏览器数据和临时目录。缓存命中不代表跳过浏览器或复用历史通过结果。

## 预检与失败复验

`npm run check:preflight` 执行 `package.json` 中的 `checkPreflight`；当前依次为类型检查、`npm run test:environment`、`npm run test:tooling` 及 `npm run test:rows`。环境预检前置 watch、检查生命周期与独立正式检出三个文件，已通过文件由同次累计机制计入后续 tooling/all，不重复执行。watch 公共夹具将 .cache/.vite/.vite-temp 可写缓存留在夹具内，包链接只读共享。工具专项覆盖检查生命周期和失败报告，行布局专项覆盖定位助手、说明展开、配音布局、滚轮拖拽、文案编辑、宽面板联动、行菜单及长文案。开发检查及正式验收都强制先预检，失败或源码失效时停止，完整检查范围仍为 typecheck/test/build。

原生 Node 测试事件同时产生 TAP 原始日志与 JSON 失败清单，包含全部失败文件、名称和位置。阶段日志记录起止时间；取消和不完整测试报告不能作为通过证据。失败待办保存于本工作树的 `logs/check-state/failures.json`。再次完整检查之前，先在当前受检源码中集中运行失败文件（文件中的其他用例也一起运行）及失败的非测试阶段；全部通过且源码稳定才解除阻塞。未知测试失败缺少精确文件时复跑完整测试，缺失或越界的已知文件则报错，不能静默漏掉。

`npm run check:failed` 可单独执行集中复验。预检、失败复验和完整检查分别留存记录；记录绑定实际执行时的源码身份。失败复验成功不等于完整验收成功，旧提交的预检通过记录不能放行新提交。

## 固定提交验收

正式验收任务提供稳定 runId、源码／环境身份、阶段、原子状态记录、心跳、完整失败清单及失败摘要。终端退出、超时或返回 143 后先查询原任务，不重新启动整套。

- `npm run verify -- start --revision <提交>` 启动或连接任务，立即返回 JSON。
- `npm run verify -- status --run <runId>` 查询，不启动任务。
- `npm run verify -- wait --run <runId>` 等待原任务；默认 `verify --revision` 保留启动并等待接口。
- `--reuse-passed` 显式复用历史成功：源码、执行器依赖、工具环境、预检及完整日志／结构化报告均须匹配。保留原 runId、完成时间和 `reused:true`，不能称为本次新验收。未知环境或缺证据时重新执行。

`npm run verify -- --revision <提交>` 是正式验收入口。先解析指定提交，再创建独立 Git 检出、执行 `npm ci` 和该提交的 `npm run check`。它不共享开发目录或 node_modules，不修改当前分支和暂存内容；检查开发目录的未提交更改仍需使用 check。正式验收要求目标提交已包含本入口及相应检查记录格式。

输出保留于 `logs/verify/run-*/`：顶层 summary.json 记录受验提交与结果，install.log 和 check.log 保存执行输出，source/logs/check/ 保存各阶段原始日志。source/ 是本次独立检出，成功和失败都保留现场。结果只证明记录的提交；交付目标变化后须对新提交正式复验。记录和所需产物已保存后可人工清理对应 run 目录；此目录不是应用管理工作树。

本机 Codex 工具的默认沙箱在命令结束时会清理后台进程环境，`detached` 无法越过此生命周期。通过该工具启动后台验收时，启动调用须使用宿主允许的持久执行入口（`exec_command` 的 `require_escalated`，遵循实际审批），查询和等待仍可使用默认沙箱。普通终端及 CI 沿用原命令。跨工具持久性须用独立调用核对，不能用同一 Node 进程里的子进程测试代替。

依赖安装或检查修改受验源码、命令失败、检查记录缺失或不匹配时均返回非零。源码符号链接和子模块当前明确拒绝。独立检出是防止日常并行编辑污染证据的边界，不是执行不可信代码的安全沙箱。

全套测试包含样式冲突和主题矩阵；定向运行使用 `npm run styles:check`。主题矩阵必须实际启动 Chrome，缺失浏览器不能视为通过。其他测试的环境跳过仍以 test.log 为准，脚本退出零不表示所有验收条款均已运行。

CI 复用正式验收入口并沿用既有日志上传。修改检查工具或 CI 时，优先用隔离小仓库回归取消子进程、互斥、提交隔离、源码失效、预检阻塞与失败清单，再固定候选提交运行全套。开发阶段先跑受影响检查，修复与审查稳定后开始完整正式验收；完整测试收集全部失败后统一复验，避免逐项修正就重开全套。

## 执行清单与统一测试证据（#149）

`scripts/test-inventory.json` 明确每个 `.test.*` 的唯一执行者及 `all`、`tooling`、`rows`、`ui-core`、`ui-extended` 范围。新增文件须登记，删除文件须同步移除；未登记、丢失、重复归属、错误执行者或空集合直接失败。UI 组件映射仍由 `ui-check-plan.mjs` 决定实际子集，执行前与清单核对。普通检查按清单分别调度 Node、Vitest 和 Playwright；完整检查在同次运行内累计已通过预检，后续仅执行剩余文件。

测试入口先输出预期文件列表。`CLAPGRID_TEST_REPORT` 指定统一记录路径；默认位于 `logs/tests/`。同目录保存 `*-native.json` 原生事件报告及 `*.json.tap.log` 可读 TAP，UI 快检保留 `ui-tests.log`。统一记录采用 `schemaVersion:2`、`kind:test-execution`，包括：

- `executor` 名称/版本，`plan` 及清单哈希，源码、配置与环境的起止身份。检查阶段创建随机 `testExecutionId`，经受控环境绑定原生与统一报告，汇总保留该原身份；默认检查拒绝复制旧报告，显式历史复用校验原阶段身份而不伪造新运行。
- `expected.files` 为执行前清单，`expected.cases` 为原生 `test:enqueue` 的运行时注册集合，`caseDiscovery` 明确其来源；它不能证明未被注册的业务场景，试点行为另由场景映射审阅。
- `actual.files` 为逐文件原生摘要，`actual.cases` 记录逐例状态、名称、位置和耗时；全局摘要必须与注册/完成集合及文件集合对应。
- 全部 `failures`、`errors`、起止时间、`complete/status`，原生来源及可读日志路径与 SHA256。

`test-evidence.mjs` 的同一校验器用于开发完整检查、UI 检查、固定提交正式验收及显式 `--reuse-passed`。成功退出不足以证明通过：报告丢失/不完整、零用例、文件/用例集合缺口、来源损坏、收集/未捕获错误、取消以及身份不符均不能通过。UI 使用严格政策，skip/todo 均失败；普通 Node 范围沿用既有 skip/todo 政策，必须明确呈现。无法定位的报告错误以未知失败进入待办，复验保守扩大到完整测试，并集保留所有已知原生对照。待办的 `referenceFiles` 来自失败阶段的原 `testPlan`，报告丢失时仍保留对照范围；复验在当前清单和快照哈希校验后执行，不能清待办漏掉原范围。所有测试执行者的失败统一按当前源码集中复验。

## 原生报告精简（#163）

Vitest 的公开入口仅保存一份来自官方 reporter 生命周期的原生事件 JSON：`onTestModuleCollected` 独立记录预期用例，`onTestCaseResult` 记录逐例结果，`onTestRunEnd` 记录未捕获错误及退出原因。保留执行者版本、nonce、文件、位置、时间和原始日志。移除未被语义消费的第二份官方 JSON reporter 及其 `sources.additional`；旧报告已有的 additional 来源仍逐件校验，不改写历史来源或降低旧证据完整性。

Playwright 继续直接消费官方 JSON，只按每个 test 的原生 results 判断唯一首次结果，避免对此前所有结果反复扫描。统一校验器仍核对全清单、注册与完成集合、实际版本、源码/配置/环境身份及原始来源 hash；成功退出不能代替这些校验。资源归属、取消、严格 UI 和同次预检去重保持原协议。完整逐场景映射、后续批次与删减依据见 [本切片记录](../research/native-execution-163/README.md)。

## 原生试点对照

`scripts/test-pilot-baseline.json` 固定原生快照哈希与 16/4/14 个原场景，逐项记录原测试、原生对照及候选对应。`tests/*.native.ts` 保留既有断言及相对 imports，清单标为 `comparison-only`；常规完整检查不运行它们，修改快照需明确重建基准。

- `npm run test:native:logic`：文本搜索 2、编辑状态 7、配音供应商协议 7，共 16 项。
- `npm run test:native:service`：真实 HTTP/SQLite 4 项。
- `npm run check:ui:native -- --concurrency 2`：固定核心完整入口，14 项含 12 项真实浏览器；另用 `--concurrency 1` 比较并发。

迁移后在同一固定试点源码、同机、相同浏览器 channel 和相同行为断言下显式运行原生/候选各至少三次；记录源码/环境、冷热缓存、并发、端到端与分项耗时。原生快照与候选不是两套常规验收。预算、并发/缓存/生命周期边界见 [ADR 0009](../adr/0009-test-executors-and-cumulative-evidence.md)。当前设计与原生基线准备不代表框架迁移、性能达标、固定提交正式验收或实际宿主交付完成。

## Vitest 逻辑与 HTTP/SQLite 试点（#150）

`npm run test:logic` 单次执行文本搜索、编辑状态计算与配音供应商协议的 16 项；`npm run test:service` 单次执行真实 HTTP/SQLite 的 4 项。固定 Vitest 5.0.5，使用项目 Node 22.23.3、Node 环境、一个 threads worker、文件隔离、零重试，拒绝 only 和零收集。迁移只替换测试器与测试结束清理钩子，场景名称和行为断言继续对应 `test-pilot-baseline.json`；原生 16/4 对照入口保留。

`vitest.config.ts` 显式采用仓库根，沿用生产 `@` alias，include 仅四个试点文件。生产 Vite 的 `src/panel` 根和 Tailwind CSS 插件继续用于面板构建；Node 试点不加载该 CSS 插件。框架配置纳入类型检查，框架不替代类型检查和生产构建。

`test-runner.mjs` 根据唯一文件归属顺序调用 Node、Vitest（及后续浏览器执行者），未迁移测试、生命周期及原生报告专项保留 Node。显式 `--files '["tests/text-search.test.ts"]'` 可交付精确集合；错误归属、遗漏、重复与空集合仍失败。默认 all、预检、集中失败复验与正式验收使用同一分派；预检与完整范围按下述同次累计规则去重。

Vitest 保存可读日志及官方生命周期原始事件 JSON（#163 移除无语义消费者的重复官方 JSON reporter）。`onTestModuleCollected` 登记的用例与完成事件分别留证，报告区分收集失败、未捕获错误、失败、中断、skip/todo，原始来源均保存摘要。普通 Node/Vitest 范围沿用非 UI 的 skip/todo 政策，逐项明确显示；浏览器严格政策不因此放宽。执行者版本须与实际安装一致。

混合范围输出 `kind:test-aggregate`，逐个引用同 `executionId` 的子报告及原生来源；文件并集必须等于预期且没有重复，逐项/汇总、源码、配置和环境均重新核对。单一执行者沿用 `kind:test-execution`。缺报告、旧运行替换、收集/未捕获错误、文件或用例缺口与取消不能通过，所有失败按当前归属进入待办并集中复验。运行与 worker 保持在已有受控进程组，取消后先回收本次后代再释放锁。

上述命令只提供所选范围的开发证据；最终同机三次性能对照、完整固定提交验收以及插件安装/实际宿主验收分别记录，不能由试点通过代替。

## Playwright UI 固定核心（#151）

固定 `@playwright/test` 1.64.1，迁移五个文件、14 项原场景，其中两项样式碰撞无需浏览器，另外 12 项实际运行本机 Chrome。`npm run check:ui -- --scope row --concurrency 1|2` 保留类型检查、固定核心、构建与生命周期清理；`npm run test:ui:core -- --concurrency 1|2` 只运行固定核心，不能当作完整入口预算。默认 UI 快检并发 2，含扩大范围或无法证明为静态样式的变更仍沿用计划器降为 1；最终并发选择与预算由同机三次对照证据决定。`npm run check:ui:native` 保留原生 14 场景对照。普通 all、rows、styles、failed 按清单分派，同次完整检查按累计规则去重。

`playwright.config.ts` 关闭重试、禁止 only。worker 手动启动 Chrome 并通过 CDP 连接，浏览器及其后代留在已有受控进程组；不会下载或改用 bundled Chromium。一个 worker 顺序复用一个 Chrome，每例新建 context/page、实际视口与窗口、DOM/storage、独立编译目录；保留原生鼠标/键盘传输、原脚本等待与断言、AG Grid 及生产同源 CSS，仅保留既有 HTTP 客户端替身边界。缺浏览器、skip、取消、零收集及未捕获错误都不能作为 UI 通过。

官方 Playwright JSON 与可读输出保留在统一报告旁，适配器从 suites/specs 收集预期场景并核对每项实际结果；统一身份与原生 metadata.executionId 绑定。混合 UI 快检仍逐项检查所有实际场景必须 passed。失败按实际声明文件进入待办，在当前源码集中复验，固定提交 verify 使用同一证据校验器。

`browser-timings.jsonl` / 可读日志记实际 Chrome 命令、版本、PID、worker 启停；逐例记录 context/target ID、目录、视口及物理窗口、编译/样式准备、缓存身份、交互和清理耗时。`check-ui/summary.json` 的 totalMs 从入口至生命周期清理完成，不能用并发用例耗时相加代替端到端时间。

资源登记在当前及祖先检查的 active 中，以 owner token、随机 resourceId、精确专属根和目录内 marker 绑定。正常清理与显式 stop 均先确认本次组结束，再核对非符号链接路径与 marker，删除成功后写根外完成证据并解除登记。worker 被强杀也由外层检查回收 profile；marker 或路径被替换则保留现场及检查锁，修复身份后通过显式 stop 恢复。另一同身份清理须有完成证据才能幂等结束，不能按目录名前缀扫描删除。


## 浏览器编译产物缓存（#154）

JS/CSS helper 默认把完整编译字节保存在当前真实工作树的 `.cache/browser-build/`。候选文件由工作树、脚本/fixture、显式构建选项和运行环境定位；返回的 `cacheKey` 再绑定完整已核对输入指纹。每次读取重新核对源码/扫描成员、实际 import 及其解析绑定、配置继承、package/lock、工具包内容和已安装依赖、外部资源。符号链接换目标、扫描文件增删和同版本工具字节变化也会失效；目录身份包含 realpath 与成员，回链终止遍历，仅缓存已确认的显式相对/绝对静态 JSON 继承链；这不会缩减检查入口原有 `sourceIdentity` 范围。

缓存只保存编译字节、完整资源清单和 SHA256，不保存测试结果。命中后仍在本次独立目录还原全部资源、创建当前浏览器 context 并执行原场景，生成新的执行身份与原生报告。历史成功复用继续使用原 `--reuse-passed` 全部校验；缓存命中不能充当累计测试覆盖。

- `CLAPGRID_BROWSER_BUILD_CACHE=0 npm run check:ui -- --scope row --concurrency 2` 显式禁用缓存。
- `CLAPGRID_BROWSER_BUILD_CACHE_DIR=/绝对路径/独立空目录 npm run check:ui -- --scope row --concurrency 2` 建立冷条件；再次使用相同目录是热条件，仍需核对实际 `cacheHit`。目录须位于工作树外或已忽略的缓存路径；未忽略的新增缓存文件仍按原规则导致源码指纹失效。指定一个新的空目录可再次建立冷条件。
- `npm run check:ui:native -- --concurrency 2` 使用相同 helper，接受同样两个环境变量；原生与候选应分别明确冷/热目录与并发，不能把共享缓存收益归因于新执行器。

未知 schema、字节/资源清单损坏、无法解析的配置读取边界以及构建期间输入不稳定时重新真实构建，不发布可命中的身份。合法但目前无法静态确认的 JSONC、包名/隐式扩展名/链接配置继承、任意 `baseUrl`、当前根配置 `@/* → ./src/panel/*` 之外的自定义 `paths`、动态 CSS/PostCSS 配置、含内部链接而无法确认运行时依赖根的工具布局及非空 `NODE_OPTIONS` 保守不缓存。工具在当前进程载入后发生变化时明确失败并要求重启，避免继续使用模块缓存中的旧实现。构建发现新依赖时先采集实际依赖，再重建确认前后输入稳定；不存在用编译后新身份给旧字节补标签的路径。

每份缓存的 metadata、主产物和全部资源一起写入随机临时文件，再以同目录 rename 原子发布。并发 worker 可以重复构建；只读取完整正式记录，取消/强杀留下的 `.tmp` 不参与读取。缓存键含真实工作树根，即使显式共享目录也分别核对，不能污染另一工作树。缓存路径是可删除的构建加速数据，不是生命周期锁或测试证据。

`browser-timings.jsonl` 保留 bundle/styles 的 `CacheHit`、`CacheReason`、完整 `CacheKey`、`CacheLookupMs`、`BuildMs`、`CachePublishMs`；lookup 包含输入枚举与内容核对，build 包含真实编译、编译前后工具核对及首次依赖确认重建，原子发布单列；模块载入和输出前的工具绑定复核仍包含在 bundle/styles 准备总耗时中。原有交互、清理、worker/Chrome 启停及检查入口 totalMs 继续独立记录；并发场景耗时之和不能代替端到端时间。冷热对照都必须呈现实际选中用例、当次执行身份及完整清理结果。
## 同次累计覆盖（#152）

宿主验收器按目标检出的 `scripts/check-evidence.mjs` 区分累计协议与此前的逐阶段协议。旧协议仍核对强制预检、完整类型/测试/构建、实际执行 nonce、目标版本的配置身份、全部原始报告、源码和严格 UI 政策；兼容旧格式不提供累计资格。已采用累计协议的目标始终要求完整 runId/proofs，不能删除报告字段后降级。固定提交验收和显式历史复用使用同一选择与校验。

完整 `check` 为本次生命周期创建随机公开 `runId` 和内存账本。集中失败复验仍先阻塞；实际通过且当前源码、配置与环境匹配的复验及预检记录可计入本次后续阶段。`typecheck` 同次实际执行一次；预检范围可以重叠，每个已通过文件只计一次。三种执行者收到精确剩余文件，零剩余不启动空测试。独立 `check:preflight`、`check:failed`、定向检查及历史日志不会自动向另一个完整运行提供累计资格。

`stage-proof-N.json` 是不可变原执行证明，含本次 runId、实际命令阶段、原 nonce、源码/配置/环境、原始日志及原测试报告 SHA256。计入的类型阶段使用 `execution:counted`、`countedAt` 与 `countedFrom`，沿用原执行时间/日志；控制台明确标示“计入…未再次执行”。真实剩余执行标为 `execution:executed`，有自己的原始报告及阶段证明，累计结果单独保存，避免覆盖来源。

`kind:test-cumulative` 保存 required plan、预期/实际文件与用例并集，以及 `sources.stages` 中的原证明和计入子集。同一个来源跨 scope 可以只计其所需文件，文件并集必须完整且无重复，每例仍对应原生注册和完成事件；来源各自的 nonce、版本、政策、全部原始报告/日志与摘要均重新校验。源证明缺失或改变、其他 runId、未登记来源、失败/取消、严格范围 skip/todo、零收集和集合缺口都不能通过。累计表示覆盖来源，不能称为再次运行测试。

固定提交验收继续独立检出、`npm ci`、生产构建及源码变化检查；默认运行只累计当前账本。显式 `--reuse-passed` 用同一校验器检查完整累计链，保留原正式 runId 和完成时间；来源损坏时重新执行，不能只凭旧退出零或某个固定日志文件名放行。最终性能与完整固定提交正式验收仍需要集成提交证据。

严格 UI 失败还保留 `strictTestFiles`，集中复验必须对原 UI 文件逐例实际 passed；不能利用普通 Node 范围允许 skip/todo 的政策清空 UI 待办。未知失败保守扩大，同时保留原生对照和严格文件；这些政策随原阶段证明参与累计与正式复用校验。累计链在最终校验或中间准备时失效，也登记未知失败并保留本次已知对照/政策范围。

## 日常相关检查（#153）

`npm run check:related` 是统一日常反馈入口，默认比较 `HEAD` 与当前工作区（包括暂存、未暂存和未忽略新文件），执行一次并退出。它先集中复验既有失败，再重新选测，执行类型检查、所选测试及适用的生产构建。既有 `check`、`check:ui`、`verify` 入口保留；相关反馈通过不能替代完整开发检查或固定提交正式验收。

- `npm run check:related -- --plan` 只查看计划，不执行测试，也不产生通过证据。
- `npm run check:related -- --base <提交>` 显式选择变更基准；非法基准报错，不回退到 HEAD。检查已提交改动时使用修改前的提交。
- `npm run check:related -- --all` 执行当前清单中的完整测试文件集合，仍不等于包含预检的完整 `check` 或独立 `verify`。
- `--concurrency 1|2` 只传给浏览器执行者；默认请求 2，非安全静态 UI 范围保守降为 1，Node 与 Vitest 的既有隔离、串行及零重试政策不变。

退出 0 表示本次相关检查通过；1 表示失败或源码 `invalidated`；2 表示 `no-changes` 或 `no-tests-selected`，没有本次改动通过证据；130 表示取消。计划查看退出 0 仅表示计划有效。日志在 `logs/check-related/`，`summary.json` 保存变更基准、变化文件及类型、逐条选择原因、预期/实际文件和用例、执行者原始来源、跳过等计数、未覆盖项、起止源码身份、各阶段及包含清理的端到端 `totalMs`。相关反馈、UI 本地反馈、完整检查与正式验收分别呈现；即使选中全部测试也始终保留 `completeForFullCheck:false` 和 `completeForFormalVerification:false`。

`scripts/related-plan.mjs` 在选测前核对整个唯一执行者清单；遗漏、删除未同步、新增未登记及重复归属直接失败。`related-dependencies.mjs` 取基准提交与当前源码的静态反向依赖并集，支持 `.js` 到 TypeScript 的扩展映射、已确认的 `@/` → `src/panel/`、export-from 和字面量 dynamic import；不支持的 paths/baseUrl/extends 即使已提交，也保守扩大，不能继续套用旧 alias。逻辑文件可选择实际消费者；测试文件修改执行自身及静态消费者。

可靠的字面量文件读取（含 fs 导入别名、基于 import.meta.url 的 URL 及目录读取）也建立输入边；读取 README 或协作文档时，实际消费者优先于文档白名单。无法解释的读取、脚本和外部执行能力可位于测试、helper 或被测试源码中，均保守纳入其测试消费者，不要求先在本次修改的静态闭包里；已确认读取其他独立文件的消费者仍可排除。计算式 fs 方法、成员对象逃逸/反射、未建模 fs 能力和非确认 URL 绑定均按未知能力保守处理，不把表面字面量当作可靠目标。

`eval`、`Function`、动态模块/worker 能力及 CJS `require` 的别名传递也按未知执行能力纳入消费者；全局对象逃逸或反射不能被当成没有输入。此处识别执行能力本身，不解析字符串脚本或假定别名仍只有表面字面量输入。

静态图不单独证明全部影响。面板交互、编辑及无法证明为静态样式的输入会加入全部面板、固定核心和静态消费者，补齐字符串浏览器脚本；逻辑依赖传递到面板时也加入这些消费者。静态样式复用既有组件映射及固定扩展范围，主题和生产 CSS 输入扩大到全部面板；CSS 导入、扫描或插件规则改变扩大到全部测试。依赖、配置、执行/打包工具、共享 helper、协议/运行入口、生产模板及 fixture 保守扩大；文件读取、外部进程、未知导入、解析错误或没有可靠映射的输入不会被当作完整的静态闭包。仅明确列出的协作文档可产生无测试状态，`docs/templates/` 等生产输入不能按文档忽略。新增正确登记或同步删除测试仍因清单/基准覆盖变化保守扩大。

执行继续使用公共分派与同一统一证据校验器，未迁移 Node 测试在扩大范围和完整入口中保留。缺报告、来源/身份/集合损坏、收集错误和零用例都失败；普通 Node/Vitest 的既有 skip/todo 政策明确呈现，UI 场景必须实际通过。失败进入同一 `logs/check-state/failures.json`，由当前源码集中复验接口处理，复验通过不取得旧运行的累计资格。

本入口与完整检查、UI 快检和正式验收共用工作树锁及取消、进程组与资源登记机制。阶段和计划边界发现源码变化即 `invalidated`，取消先回收本次进程/浏览器/目录再释放锁，其他工作树不受影响。`checkRelated(root, options)` 提供可复用的单次运行接口；持续 watch 由后续独立功能提供，本票不会隐式进入 watch。

## 显式日常 watch（#155）

`npm run check:related -- --watch`（或 `npm run check:related:watch`）开启持续会话；没有 `--watch` 仍执行一次退出，`--plan` 不与 watch 同用。会话启动时把 `--base`（默认 HEAD）固定为实际提交，各轮沿用此基准；提交后要更新比较基准时停止并重新启动。每轮新进程重新使用单次选测、集中失败复验、类型/测试/适用构建及统一证据校验，不把前轮 passed 自动计入本轮。准备产物只沿现有 helper 的适用缓存规则复用，不保留浏览器页面/context 或测试通过资格。

会话在 `starting/running/cleaning/idle` 全程持有同一工作树锁，idle 只是等待输入。完整检查、UI 快检、正式验收及第二个 watch 仍互斥；不同真实工作树独立。使用 SIGINT/SIGTERM 或 `npm run check:stop` 停止，回收本次登记组及浏览器专属目录后释放锁，取消退出 130。拥有者被强杀时保留锁及原现场，按既有 `check:stop` 身份核对与恢复流程处理，不能据旧心跳或某个命名空间 PID 缺失直接清锁。watch 不作为同树检查的继承子阶段绕过锁。

`logs/check-watch/<会话>/summary.json` 保存 owner/sessionId、请求及固定基准、状态、输入事件 generation 和各轮引用。每轮有随机 roundId、新 testExecutionId、独立 `summary.json` 与原生报告/日志，`watch-round.json` 保存输入 generation 前后、实际状态和包含清理的端到端耗时。单次记录也绑定本轮 nonce；缺少完成记录、旧轮重放、退出状态不符和测试后损坏原始来源都进入未知失败待办。最终仍使用公共校验器核对测试来源及 UI 严格政策。局部反馈始终不等于完整检查或固定提交正式验收。

父拥有者在启动子入口前独立记录选中集合、主阶段及集中复验的完整预期，并为主测试和每个复验测试预分配不同 UUID；校验实际 raw 必须使用这些值，不能从子摘要自报执行身份，也不能删除测试阶段后靠空遍历放行。公共 runner 的可选 context nonce 工厂只用于这种实际拥有者关联；默认仍生成随机 UUID。非法 UUID 或同 context 重复值在启动阶段前拒绝，不改变集中复验三参数接口或完整检查的私有累计账本。

子轮失败也必须保留完整复验阶段记录，父才能确认哪些原待办已有可信通过来源。记录缺失或截断时登记未知测试失败；任意新失败清单的存在不能证明原待办仍被保留。更一般地，最终轮次不是 passed 时，父无条件把启动前的全部待办阶段、原普通失败文件、原生对照和严格范围并回清单，不依赖负状态子摘要决定清除范围。只有整轮实际 passed 且父完整核验通过才允许清除原范围；复验实际通过但主类型检查失败，也会在下一次输入后重新复验原范围。负状态主阶段可以正常提前停止，未执行的主阶段不会伪装成已通过，无输入仍不自动重试。

父恢复失败位置时只补当前清单缺少的完整记录；对象字段顺序不影响等价，数组和全部位置、message、native 身份字段仍参与比较。连续负轮不会反复倍增原记录，同名同文件但不同位置或身份的记录不会合并，也不截断未知失败范围。

watch 的受控环境把保留策略绑定实际父 owner 的 canonical root/token。公共复验接口仍为三参数，只在当前生命周期 registry/祖先与 active `related-watch` 拥有者一致时保留清单；嵌套完整检查的新 context 也沿同一环境核对。旧 token、非 watch 拥有者和路径别名拒绝清单，跨工作树不取得此资格，普通复验默认通过后清单。原待办直到父最终通过之前始终留盘，因此 owner SIGKILL 或资源清理异常没有先清后恢复的空窗。父在最后清理、输入 probe 和 generation 判定后同步核对原清单 SHA256 再删除；新未知待办或身份变化一律保留并阻塞。

后续阶段失败或输入变化不会免除已通过来源的最终核对。watch 父拥有者逐个重验本轮声称通过的测试原始来源，完整检查也重验本次账本全部已通过证明；损坏链明确要求复验测试并登记未知失败，同时保留复验开始前已知的原生对照和严格文件。这样已通过的集中复验即使先清过待办，也不能因后续类型检查或构建失败而丢失测试范围。运行期间源码身份失效时，watch 也保守保留测试待办；新输入触发后先实际集中复验，再以独立 nonce 执行该轮主测试，两者均保留原始报告。日常单次/watch 的复验与主测试分开，完整 check 仍沿用同次私有账本累计去重。没有新输入时仍不会自动重试。纯类型检查失败仍只登记其实际失败阶段。

源码事件合并后触发实际一轮；执行中变化会使旧轮 `invalidated`，等待旧轮安全收尾再按最新输入重新选择，不对旧轮发会取消整个会话的局部 SIGTERM。已经观察到的事件即使恢复相同 bytes，也不能让旧轮自动成为新轮证据。同输入失败后 idle 等待新输入，无定时自动重试；新输入先集中复验既有待办，严格 UI skip/todo 仍阻塞。

文件系统事件之外，每约 2 秒重新读取当前代码检查范围的完整内容指纹作兜底；它只发现输入变化，不产生通过证据，也不用 mtime/历史哈希替代实际执行边界。大仓库的扫描有持续 CPU/磁盘成本，watch 重跑和 idle 时间单独记录，不能替代默认单次预算。事件缺路径、监听错误、执行脚本或实际 node_modules 安装变化会保守进入 `restart-required`，等当前轮回收后退出 1，要求重启；`npm ci`/依赖恢复不会在旧模块进程中悄悄继续。明确排除 node_modules/.vite 与 .vite-temp 等 Vite 执行器临时输出，避免自身触发循环；源码、配置、模板、helper、CSS 与清单变化继续沿单次入口保守扩大或拒绝。

Node 22 递归监听在临时子目录删除时可能发出 `ENOENT/scandir`，根监听仍保持。仅当错误路径 canonical 且位于已 attach 根内、现存祖先无未知符号别名、Git 确认已忽略且没有 tracked 后代时才把它记为 `ignoredDirectoryRaceCount`；路径任意祖先段含 node_modules 都属于真实依赖输入，普通变动及目录错误均要求重启，仅工作树根下既定 Vite 临时目录白名单适用。未忽略目录、忽略目录中的 tracked 输入和其他错误继续 fail closed；此分类不忽略源码事件，也不把丢失根句柄当作无事发生。

`inputObservation` 分别累计初次完整扫描、后续 probe 次数及耗时。每轮 `debounceAndProbeMs` 记录合并等待和输入复查，`totalMs` 记录本轮准备/实际执行/最终校验及清理，`feedbackMs` 从首个已观察到的待处理事件起算，包含等待旧轮收尾；无法据此推断 OS 事件被观察前的延迟。正常多轮、执行中停止、上游取消、拥有者/worker 强杀恢复及旧 token 拒绝均使用真实进程和 Chrome 回归，不以 watch 热轮耗时代替单次性能预算。

业务 UI 的严格政策按文件身份执行，适用于 `all`、`rows`、相关测试、集中复验和正式验收。未迁移的 Node 浏览器业务文件在唯一清单登记 `policy:ui`；Playwright 文件、UI scope 及 `native-ui` 对照同样严格。计划的 `strictFiles` 明列子集，逐文件拒绝 skip/todo，不因所处命令而放宽，也不扩大到非 UI 的普通 skip/todo。新增 Node 业务 UI 测试需同步登记政策；浏览器启动、缓存和生命周期专项的 OS 能力回归不按文件名当作业务 UI。

旧清单未采用政策字段时，执行计划保留旧 JSON 形状；当前校验器仍独立按 UI scope、执行者、原生组和 a0558ff 已确认的 33 个 Node 业务 UI 兼容映射强制政策。旧检出实际 UI passed 可验证，旧 skip/todo 不会因格式兼容而放行；新清单采用明确 policy 后以当前声明为准。冻结旧执行器测试夹具验证此边界，CI 不依赖完整 Git 历史。

## 启动准备与测量条件（#156）

源码身份配置 `scripts/source-identity.json` 的 schema 2 选择 `sha256-merkle-v1` 与 `code-check-v1` 范围，异步入口默认至多 4 个短期源码线程，API 可显式请求至多 8 个；无配置的历史目标继续原协议。每个边界仍读取全部当前内容，取消等待本次全部线程退出。单一 Vitest 可在读取期间预载纯框架，当前身份完成后才执行项目配置、setup 和测试；未知预载条件保守串行。协议及完整输入边界见 [试点记录](../research/test-executor-pilot.md#完整准备协议)。

核心仅在 segment、table、wide 三个已隔离文件内并行；speech 三场景与 CSS 两场景保持串行，CSS 共用扩展 test 的 worker pool 而不请求浏览器 fixture。并发上限仍为 2，扩展/未知集合仍保守降为 1。JS 开发 bundle 压缩并保留名称；CSS 框架在真实缓存 miss 时加载。准备路径变化后仍执行原脚本、等待、断言与独立 context/page，零重试。

采用 `scripts/node-compile-cache.mjs` 的目标仅给单次受控测试 child 派生 Node 字节码缓存默认目录：canonical 工作树的 `node_modules/.cache/clapgrid-node-compile-v1`。父 main、源码线程、类型检查与构建不额外自动开启；显式 `NODE_COMPILE_CACHE`（包括空字符串）及 `NODE_DISABLE_COMPILE_CACHE` 保留。切换工作树/正式独立检出时，自动默认按实际目标重派生。旧目标缺政策模块时保留原配置/环境身份形状。

watch 的异步派生链关闭自动默认，跨子孙传播该保守策略，显式用户控件仍优先；同进程独立任务继续正常默认。依赖目录规则不增加缓存白名单，内部实际依赖变化仍要求重启。字节码只减少编译准备，每次测试仍产生本次 nonce、真实执行及原生报告。

`browser-timings` 新增导航、视口核对、结果等待/轮询与 browserInput binding 请求耗时/计数。请求耗时与页面运行、结果等待可能重叠；它们都是观测到的 wall-clock，不能相加当 CPU 或入口收益。完整入口仍包含类型检查、测试、生产构建和生命周期清理。

原生/候选各至少三次、并发 1/2、冷/热及默认字节码条件按 [测量方法](../research/test-executor-pilot.md#测量方法) 分开记录。最终数字、固定提交正式验收及 CI 来源写回 [#156](https://github.com/dulltackle/ClapGrid/issues/156)。记录与交付必须对应同一受验提交；源代码与文档变化后重新固定目标并检查受影响证据。
