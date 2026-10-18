# 检查与正式验收

先选择当前工作所需入口，再按条件读协议。开发检查允许未提交内容；正式验收只证明指定提交，须在独立检出安装锁定依赖并执行完整链。局部检查、历史结果、取消或未知状态不能替代正式通过。完整技术协议与既有边界保存在 [验证协议](verification-protocols.md)。

- 开发阶段：定向文件测试和类型检查；稳定候选只做一次完整正式验收，修复后重验受影响项及新候选要求的完整检查。
- 长检查启动一次并保存身份、日志和摘要。终端退出/超时先查询原任务；活动资源通过原入口收尾。有效原证据继续复用，保留原身份/时间。
- 正式验收必须核对目标提交、源码、环境、范围、原始报告和真实执行。缺失/损坏来源、零收集、集合缺口、skip/todo 不符合范围政策时不能通过。

## 代码检查输入

变更源码身份、选测或 watch 输入前，读 [代码检查输入](verification-protocols.md#代码检查输入) 和 [ADR0010](../adr/0010-code-check-input-boundary.md)。schema 2 的 code-check-v1 仅排除指定历史材料目录，保留代码、配置、模板、全部 fixture 及未知路径；旧通过证据不转换范围。

## 运行与取消

启动、停止、跨命名空间、异常锁恢复或后台任务前，读 [生命周期](verification-protocols.md#运行与取消)。普通入口共享工作树锁；正式任务观察者退出不取消 worker。本地 PID 不可见不能证明终止。

## UI 迭代

纯样式先 `check:ui` 并实际核对面板；升级范围、映射、并发和严格 UI 政策见 [UI 协议](verification-protocols.md#ui-迭代)。

## 预检与失败复验

完整链强制 typecheck→test:environment→test:tooling→test:rows。环境差异相关 watch/生命周期/正式检出测试提前，后续同次累计去重；watch 可写缓存统一隔离。预检或源码失效即停止，原失败待办先集中复验。改动相关机制前读 [预检协议](verification-protocols.md#预检与失败复验)。

## 固定提交验收

`npm run verify -- start --revision <提交>` 保存 runId；用 status/wait 查询原任务。开始最终验收、复用历史或清理现场前读 [固定提交协议](verification-protocols.md#固定提交验收)。本机跨工具持久执行沿宿主批准入口，不能用同进程子任务测试代替。

## 执行清单与统一测试证据（#149）

新增/删除测试或改执行者、报告、失败复验时读 [清单与证据](verification-protocols.md#执行清单与统一测试证据149)，保持唯一归属及原始来源完整性。

## 原生试点对照

改原生基线或做性能比较时读 [原生对照](verification-protocols.md#原生试点对照)，并保留尚未达标的性能事项。

## Vitest 逻辑与 HTTP/SQLite 试点（#150）

改逻辑/服务执行者、收集或取消时读 [Vitest 协议](verification-protocols.md#vitest-逻辑与-httpsqlite-试点150)。

## Playwright UI 固定核心（#151）

改 UI 执行、浏览器 worker/context 或严格政策时读 [Playwright 协议](verification-protocols.md#playwright-ui-固定核心151)。

## 浏览器编译产物缓存（#154）

改构建复用时读 [缓存协议](verification-protocols.md#浏览器编译产物缓存154)，命中不跳过实际浏览器执行。

## 同次累计覆盖（#152）

改预检顺序、文件集合或累计账本时读 [同次累计](verification-protocols.md#同次累计覆盖152)，只能累计同运行、同身份的真实原来源。

## 日常相关检查（#153）

改选择器或 implicit 输入时读 [相关检查](verification-protocols.md#日常相关检查153)，局部 passed 不升级成完整通过。

## 显式日常 watch（#155）

改 watch/资源/失败清单/变化检测时读 [watch 协议](verification-protocols.md#显式日常-watch155)，无输入不自动重试。

## 启动准备与测量条件（#156）

改线程、字节码、CSS/浏览器准备或测量时读 [准备协议](verification-protocols.md#启动准备与测量条件156)，性能预算和原覆盖保持原要求。

## CI 并发与时限（#158）

push 验证分支 tip，PR 验证默认合并结果，手动触发保留。自动初次运行按 workflow/event/ref 分组替换；手动和重跑以 runId/attempt 独立，旧提交重跑不取消新检查。分组不保证提交年龄顺序。[GitHub 并发语义](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) 与 [运行身份](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#github-context) 是配置依据。

CI artifact 保存 ci-timing.json，记录首步骤到汇总时的实际耗时和作业时限余量；runner 准备和后续上传不在窗口。完整作业时长以实际 GitHub job started_at/completed_at 核对。取消不算通过，不缩短单用例时限和覆盖；check 保持60分钟、process-trace保持15分钟。
