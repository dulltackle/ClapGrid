# 旧测试基础设施退出与产品保障

#200 基于 #199 已接入的原生 CI 完成最后消费者清理。旧命令、参数、测试报告和日志约定直接废弃；没有转发、结果转换或新的统一执行协议。以下是删除记录，不作为运行时收集清单。

## 按机制退出

| 机制与删除理由 | 仍有意义的故障承接 |
| --- | --- |
| Node adapter/TAP、Vitest/Playwright包装执行器和bootstrap：只验证旧适配协议，本身退出 | 原生配置按 `tests/**/*.test.ts` / `**/*.spec.ts` 收集；框架负责隔离、等待、生命周期、失败结果和附件。产品故障见各 `native-*` 承接说明 |
| AST相关选测、UI选测、统一watch和固定核心矩阵：移除第二套依赖/调度规则 | 使用原生过滤/watch/debug，非导入资源、外部程序和配置变更由开发者扩大定向范围，CI全量执行 |
| 执行清单、轮次/源码身份、累计账本、失败待办、预检/失败复验和历史成功复用：移除旧资格与结果认证 | 当前命令或CI检出的提交、原生报告和实际失败附件提供本次结果；取消、缺报告、未运行不能算通过 |
| 测试工作树锁、后台worker、心跳/重连/状态、资格哈希/重叠调度：不再有持久检查作业 | 普通前台原生命令可中断重跑；产品服务生命周期由 `service-exit-wait`、`lifecycle-export`、`project-import` 及workspace/runtime测试保留，具体进程身份 helper 已由 #198 解耦 |
| Node专用编译缓存与浏览器准备缓存协议、冻结缓存对照：不再验证缓存资格/跨轮复用 | 标准Vite生产构建接入Playwright worker fixture；浏览器与context由框架拥有，临时项目/面板/媒体由具体fixture清理，不重建通用缓存协议 |
| 字符串fixture、手工Chrome/DevTools启动、输入/结果轮询桥接、旧theme/覆盖点助手：最后产品消费者已迁移 | 真实HTTP/SQLite、AG Grid/Radix与原生page/locator/expect承接。主题/布局和真实CSS冲突仍由 `layout.spec.ts`、相关UI场景及 `style-collisions.test.ts` 的生产CSS负例保障 |
| 四组legacy冻结执行器及旧报告历史对照：只验证已废弃格式 | 不保留旧格式兼容层；产品旧Python归档与插件升级数据兼容是另一类保障，继续保留 |

`tests/helpers/temporary-repository.ts` 只保留 `dependencyView`，由 `build-identity.test.ts`、`production-document.test.ts`、`panel-release.test.ts`、`plugin-update.test.ts` 实际消费；删除无消费者的 temporaryRepository/withEnvironment 及旧后台停止接线。只读依赖视图与各夹具自身可写缓存不等于跨轮准备缓存协议。

## 保留的产品边界

- `scripts/production.mjs`、`scripts/production/**` 的制作材料、evidence、verify-package、引用、审阅证据、归档完整性和可靠发布全部保留。`production-archive-*`、`production-reference-encoding` 等真实旧Python数据夹具不属于本次删除的测试执行器legacy目录。
- 生产构建身份、插件构建/更新/安装身份、项目数据保留、真实宿主证据协议及其产品测试继续保留；`plugin:verify` 没有改作测试报告认证，也没有在本票执行安装或宿主更新。
- 配音导出互斥仍由 `speech-export-lock.test.ts`、`verify-speech-export-processes.mjs` 和每个 PR 的专项验证（手动入口保留）；保留真实FFmpeg正向exec及七拒绝窗口。产品正常/失败/取消退出及只清理本次拥有资源的保障不删除。
- `style-collisions.mjs`、例外理由数据及真实生产CSS冲突测试保留。`review:check` 与产品审阅引用检查、`ci-observation.mjs` 简单实际耗时观察保留。

## 当前入口与验收边界

`npm test` 直接执行 `vitest run`，`npm run test:ui` 直接执行 `playwright test`。过滤、watch、debug使用各框架CLI；`npm run check` 只依次组合 `npm run typecheck && npm test && npm run test:ui && npm run build`。原生零重试、禁止only、空收集失败保持，配置无专用旧文件exclude或第二份执行清单。#199的CI在自身checkout分别执行这些原生命令，本票不改workflow。

2026-10-20 用户确认本次性能改前、改后各1轮，只报告实际变化，取代原三轮及改善超出波动要求。开发定向检查、收集、npm ci与构建不是额外性能样本。稳定候选统一执行完整本地检查和真实CI后，再记录本轮实际观察；收集与定向通过不代表全套执行已通过。历史研究/通过原件保留原义。源码清理不代表插件安装或实际宿主交付完成。

## 完整删除清单

### 脚本与旧清单（31项）

- `scripts/check-evidence.mjs`
- `scripts/check-lifecycle.mjs`
- `scripts/check-related.mjs`
- `scripts/check-runner.mjs`
- `scripts/check-source.mjs`
- `scripts/check-ui.mjs`
- `scripts/check-watch.mjs`
- `scripts/check.mjs`
- `scripts/node-compile-cache.mjs`
- `scripts/playwright-evidence.mjs`
- `scripts/playwright-resources.mjs`
- `scripts/playwright-runner.mjs`
- `scripts/related-dependencies.mjs`
- `scripts/related-plan.mjs`
- `scripts/source-identity.json`
- `scripts/test-evidence.mjs`
- `scripts/test-inventory.json`
- `scripts/test-overlap.json`
- `scripts/test-pilot-baseline.json`
- `scripts/test-reporter.mjs`
- `scripts/test-runner.mjs`
- `scripts/ui-check-plan.mjs`
- `scripts/verification-jobs.mjs`
- `scripts/verification-worker.mjs`
- `scripts/verify.mjs`
- `scripts/vitest-bootstrap.mjs`
- `scripts/vitest-evidence.mjs`
- `scripts/vitest-reporter.mjs`
- `scripts/vitest-runner.mjs`
- `scripts/watch-inputs.mjs`
- `scripts/watch-round.mjs`

### 旧机制专属测试（14项）

- `tests/check-related.test.ts`
- `tests/check-runner.test.ts`
- `tests/check-source.test.ts`
- `tests/check-watch.test.ts`
- `tests/node-compile-cache.test.ts`
- `tests/playwright-runner.test.ts`
- `tests/test-evidence.test.ts`
- `tests/test-reporting.test.ts`
- `tests/ui-check-plan.test.ts`
- `tests/ui-check-runner.test.ts`
- `tests/verification-jobs.test.ts`
- `tests/vitest-runner.test.ts`
- `tests/browser-build-cache.test.ts`
- `tests/browser-startup.test.ts`

### 无消费者旧helper（11项）

- `tests/helpers/browser.ts`
- `tests/helpers/browser-build.ts`
- `tests/helpers/browser-startup.ts`
- `tests/helpers/editing-fixture.ts`
- `tests/helpers/interactive-browser.ts`
- `tests/helpers/panel-styles.ts`
- `tests/helpers/panel-targets.ts`
- `tests/helpers/persistent-build-cache.ts`
- `tests/helpers/playwright-browser.ts`
- `tests/helpers/relative-insert-fixture.ts`
- `tests/helpers/theme-contract.ts`

### 冻结测试协议夹具（9项）

- `tests/fixtures/cache-fingerprint-9ef.ts`
- `tests/fixtures/legacy-18c9678/test-evidence.mjs`
- `tests/fixtures/legacy-a0558ff/check-runner.mjs`
- `tests/fixtures/legacy-a0558ff/test-evidence.mjs`
- `tests/fixtures/legacy-a0558ff/test-runner.mjs`
- `tests/fixtures/legacy-ad5573a/test-evidence.mjs`
- `tests/fixtures/legacy-d1e740a/check-runner.mjs`
- `tests/fixtures/legacy-d1e740a/test-evidence.mjs`
- `tests/fixtures/legacy-d1e740a/test-runner.mjs`

## 本票定向检查

删除后原生收集为 Vitest 60文件256条、Playwright 16文件156条。收集不执行测试；它只确认保留产品文件实际进入框架，不能替代完整运行。`dependencyView` 的四个产品消费者定向运行9条全部通过，类型检查（含production工程）、生产构建及 `review:check` 通过。完整本地检查和真实 CI 留给独立集成审查后的固定候选统一运行；本票未执行额外性能样本，也未安装插件或更新实际宿主。
