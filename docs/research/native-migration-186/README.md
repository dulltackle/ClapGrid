# 第一步宿主迁移等价审计（#186）

> 历史阶段记录：以下正文保留 `727c9b7` 第一步候选提交时的 1113 场景和待验状态，不代表当前状态。其后已有第一步正式、共享服务泄漏修复后的 `f049da1` 串行正式及第二步九轮对照；最终默认候选仍需独立正式。完整沿革和当前边界见[最终集成索引](../native-integration-190/README.md)。

当前完成源码与逐项对应收口，第一步固定候选完整等价验收仍待执行。第二步执行者重叠、资源配额与性能实验尚未验收，只有 #186 全部标准取得对应证据后才能进入 #187。等价不以加速为条件。

## 原覆盖与唯一归属

[逐项映射](scenario-map.json)汇总 54 个原 Node 文件的 817 项原场景、18 个既有 Vitest 文件的 86 项和 38 个 Playwright 文件的 196 项，共 1,099 项。原身份使用历史实际报告的 file/name/nesting，逐项关联 #176–#185 映射来源及 SHA-256。文件集合仍为 110 个，所有 scopes/policy 与原清单相同；旧 18 个 Vitest 与 38 个 Playwright 源码 SHA 均未变化。当前唯一归属为 72 Vitest、38 Playwright，常规 Node 文件为零；原生对照单独属于 comparison-only。

14 个新增回归独立列出：#175 公共夹具 1 项、#176 宿主故障及生命周期 12 项、#179 mock 恢复 1 项。预计实际集合共 1,113 项，新增项不填补原覆盖。没有文件拆分或移动；watch 原首例改名保留增强隔离反例，并在逐项映射保留 oldName/newName。普通 Linux 组件安装场景保留“安装组件验证需要 Ubuntu 24.04 运行环境”的原 skip 政策与原因；正式报告必须逐项呈现，不扩展到严格 UI。

映射证明对应关系，既有批次的真实定向结果证明各自原提交的局部行为。当前候选的实际全量执行集合、通过状态及环境仍需正式原件。[证据索引](evidence-index.json)固定批次独立审查、同步检查和修复来源的路径及 SHA；可变 run.json 仅用于协调，不作为唯一证据。

## 调度、时限与生命周期

vitest.config.ts、scripts/vitest-runner.mjs 的普通 CLI 与 scripts/vitest-bootstrap.mjs 的预加载 API 统一 forks、一个 worker、文件串行、isolate、retry 0。scripts/test-runner.mjs 的执行者循环等待前者结束后再运行后者；Playwright 保留原文件级执行方式和默认请求 2，不添加跨执行者重叠。

原 Node 文件在注册前设置原生 testTimeout/hookTimeout 为 0，保留原无限默认；显式 timeout、内部等待及子命令时限继续生效。旧 18 个 Vitest 文件保持原默认 5 秒 test/10 秒 hook 及原显式时限。Node after 的 FIFO 与 Vitest onTestFinished 的 LIFO 按依赖顺序适配：先关闭业务、数据库、原进程与所属后代，再删除目录。#176 的真实公开入口回归覆盖逐例清理、beforeEach 登记、下一例前 mock/环境/global/计时器恢复、显式测试/清理超时、hook/异步失败、跳过前清理失败及文件配置隔离；#179 新增下一例文件删除恢复，其他票保留真实 Node 子进程、FFmpeg、HTTP/SQLite、Chrome、watch 和固定检出。

公共 dependencyView 启动前预建四类本地可写缓存 .cache/.vite/.vite-temp/.vitest-cache，并排除共享链接；#183 的工具故障注入先 realpath 包源，断言复制目标独立后才变造。原污染与失败报告保留，官方锁定包 SHA512 恢复记录和共享树核对单列于证据索引；失败原件不改写为通过。

## Node adapter 审计

本阶段保留 Node 路径，没有仅因常规 owner 为零而删去真实调用者所需的保障。

|保留部分|实际调用者与保障|
|---|---|
|test-runner.mjs 的 runNode、Node loader 与串行原生 child|test-evidence.test.ts 的临时 Node 仓库、check-watch.test.ts 的真实长驻及嵌套仓库、vitest-runner.test.ts 的 Node/Vitest 串行对照、playwright-runner.test.ts 的混合执行与累计回归；9 个 .native.ts 历史快照通过 native-logic/native-service/native-ui 显式入口执行。|
|test-reporter.mjs 的 test:enqueue/完成事件、逐文件/全局 summary 与 TAP|test-reporting.test.ts 直接启动真实 node --test 和该 reporter；runNode 同时保存 TAP 与原生 JSON。校验器核对收集/完成集合、nonce、源码与环境、原文件、摘要和原始来源 SHA，缺损、零收集、错误及取消拒绝通过。|
|test-evidence.mjs 的 Node 归一化、版本、comparison-only 及旧协议分支|真实 Node fixtures 与历史快照继续使用；test-evidence.test.ts 的 legacy-a0558ff/d1e740a/18c9678/ad5573a 冻结生产者实际生成旧结果，当前宿主校验，并注入损坏、错 nonce、伪累计及 UI skip/todo 反例。冻结 fixture 保持原字节。|
|nodeEvidence 兼容导出|当前生产 runner 已使用 executorEvidenceAsync；冻结旧 runner 仍引用旧导出名。当前别名虽无当前静态直接调用，本阶段保留该单行兼容表面；没有为删除它新增接口或改写历史 fixture。|

Vitest/Playwright 原生框架承接常规收集、调度和逐例生命周期；项目适配继续承接唯一归属、code-check-v1 身份、严格 UI、原始来源完整性、同次累计与失败复验、工作树锁和拥有者取消清理。框架退出 0 不能替代这些校验。缓存命中仍实际执行，历史 passed 不自动计入当前运行；预检顺序维持 typecheck → test:environment → test:tooling → test:rows，完整范围继续 typecheck/test/build。

## 固定候选验收门槛

稳定 diff 先经独立 baseline 到候选的完整审查，finding 闭环后正常提交。按既有 `npm run verify -- start --revision <SHA>` 在独立检出执行锁定依赖 npm ci、完整检查、生产构建及源码/来源核对；保存 runId，沿 status/wait 查询原任务和原件，观察者退出不等于取消。只有实际拥有者可取消，全部所属进程组退出后才释放锁；历史未知资源保留身份与状态。

本说明尚未记录固定候选通过。取得原正式结果后另行记录候选提交、范围、真实环境、原始报告与结论；局部检查、动态 list、历史结果及本静态索引不替代实际全量。源码未推送的部分、安装包、实际宿主分别报告；本阶段没有更新插件安装包或实际宿主。
