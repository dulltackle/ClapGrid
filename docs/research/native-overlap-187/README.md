# 取得资格文件的执行者重叠（#187）

本切片在 #186 的串行等价基础上增加显式对照模式，默认仍为 `serial`。并发资格与迁移归属分开维护；未列出、文件内容变化或执行清单变化均不能继承旧资格。默认配置的最终选择留给 #189 的同机、同提交、同覆盖完整入口测量，不能由本切片的局部耗时决定。

## 公开入口与边界

```sh
npm run check -- --execution serial
npm run check -- --execution overlap-1+1
npm run check -- --execution overlap-1+2
```

三种模式都先集中复验，再强制执行 `typecheck → test:environment → test:tooling → test:rows`；预检失败或源码失效直接阻塞后续。`serial` 保留第一步的 Playwright 默认请求 2。重叠模式只处理同次累计后尚未执行的 `test` 文件：先执行全部未获资格文件，再让取得资格的 Vitest 与 Playwright 两路重叠。任何一侧没有剩余资格文件时沿原生串行入口执行，避免为单侧集合制造聚合。Vitest 始终为 forks、一个 worker、文件串行、isolate、retry 0；Playwright 按模式请求 1 或 2，仍沿原生文件调度与既有逐例隔离。

`test-runner.mjs` 的直接调用、预检、集中复验与 UI/相关检查入口没有新增重叠权限。所有 slice 均通过既有 `npm run test -- --files ...` 执行；没有增加用例调度器、线程池或重试。检查摘要、原阶段证明和每路日志清单分别记录请求模式、实际命令、文件、nonce、起止时间及报告位置；原生 Playwright 报告保留实际 worker 配置。

## 集中资格与真实原文件依据

`scripts/test-overlap.json` 只维护重叠资格，不改变 `scripts/test-inventory.json` 的唯一归属与范围。资格要求 `qualified: true`、已存在且归属吻合的清单项、当前文件 SHA256、当前整份清单 SHA256 同时匹配。缺失/重复/错误归属的资格项拒绝执行；内容或清单身份变化降为独占。涉及隔离假设的生产代码、helper、资源或执行方式变更仍须重新审阅资格并保留新的真实证据。

| 文件 | 隔离依据 | 原文件真实重叠证据 |
| --- | --- | --- |
| `tests/export-tasks.test.ts` | 每例独立 mkdtemp/SQLite/媒体路径；关闭业务层及 FFmpeg 子任务后清理；文件内 mock 逐例恢复，fork 隔离 | 18 项实际通过；与两侧 UI 原生用例均有时间交集 |
| `tests/audio-panel.test.ts` | 逐例独立 context/page/临时资源及随机 HTTP 端口；Chrome/资源根按执行 nonce 登记 | 3 项实际通过；与 Vitest 单例最大交集 5935 ms |
| `tests/video-panel.test.ts` | 同一既有受控浏览器 fixture；独立 context/page/临时资源与端口，不共享编辑状态 | 11 项实际通过；与 Vitest 单例最大交集 3500 ms |

资格轮使用同一实际拥有者登记的两个原命令，Vitest 1 与 Playwright 1 同时运行，保留两份独立 nonce、原始 native JSON、可读日志与统一报告。外部运行记录为 `clapgrid-174-20261018/187/qualification-11/`；独立审阅按 Vitest 的逐例完成时间/耗时与 Playwright 的原生开始时间/耗时计算交集，结果位于同次运行的 `187-review/qualification-overlap-independent.json`。这不是完整检查链性能测量，也不以可控同名夹具替代实际原文件资格。

## 证据、失败与取消

独占段与两路分别保存日志及原生报告。每个 slice 的子 nonce 从本阶段随机父 nonce 与固定索引派生；汇总从父身份重新计算预期子身份，不能仅信子报告自报的 nonce。聚合校验原件 SHA256、源码/配置/环境、实际文件和用例并集、重复归属、严格 UI 与原生错误，并采用全部子报告最早开始/最晚结束作为时间范围。同次累计仍引用原阶段证明，保留其不可变来源链。

一路普通失败、worker 退出或子报告读取失败不会自动取消另一侧；已开始的两路先收齐结果，再报告失败。子报告缺损时保留每路路径、原计划与失败待办，不能留下完整通过。取消沿同一个 `runCheck` context 的工作树锁和原有拥有者协议，先收齐本次登记进程组及资源再释放锁；不按命令名扫描或终止其他工作树。

`tests/test-evidence.test.ts` 从真实完整 CLI 验证原生两路互等、未知文件独占、缺失资格拒绝、改写文件自动降为独占、预检阻塞、普通失败完整收集、截断子报告失败及真实 Chrome/FFmpeg 后代取消。受控夹具与真实原文件资格分开留证。取消原件记录实际两组、Playwright 资源登记、两个后代 PID 均返回 ESRCH，以及锁已释放；独立核对位于同次运行的 `187-review/cancel-independent.json`。

跨工作树同时运行、迟到登记、更多 worker/未捕获错误与完整 raw 故障矩阵、1+2 实际资源边界以及失败待办实际恢复属于 #188；本切片不以已有局部结果声称这些后续条款已完成。完整性能对照、最终固定提交正式验收、安装包与实际宿主交付仍分别保留其验收边界。
