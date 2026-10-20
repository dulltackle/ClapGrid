# 项目与工作空间的原生保障

本批保留已直接使用 Vitest 的有效产品测试；不为迁移重复实现同一行为。`vitest.config.ts` 通过 `tests/**/*.test.ts` 收集，每个文件只执行一次。`service.native.ts` 与 `service.test.ts` 除框架导入及清理 API 外逐字相同，删除冻结的 Node 对照。

| 产品故障 | 保留的原生测试 | 实际边界与清理 |
| --- | --- | --- |
| 项目任务受理或终态保存失败、恢复清理失败导致错误解锁 | `project-access.test.ts` | SQLite 故障与真实业务/HTTP；关闭后删除本例目录 |
| 显式迁入拒绝运行中来源、保留原件/稳定数据、发布竞态和中断不可误认成功 | `project-import.test.ts` | 实际迁入 CLI、HTTP、SQLite、MCP 子进程；确认本例进程结束后清理 |
| 粘贴、重排、删除发生过时身份/顺序变化，选择范围被扩大 | `organization.test.ts`、`relative-insert.test.ts` | 真实业务数据库事务；稳定身份、逐项结果与回滚 |
| 修改权冲突、中断、旧取消凭据、保存失败或第二个服务错误覆盖 | `modification.test.ts` | 真实 HTTP/长连接、SQLite 和两个服务；原生逐例清理 |
| 非法请求、跨实例地址、提交结果与磁盘结果不一致 | `service.test.ts` | 真实 HTTP、SQLite 占用/重开；不访问假客户端 |
| MCP 与面板数据不一致、服务离线未反馈、宿主 roots 被误当对话绑定 | `mcp.test.ts` | 实际 MCP transport 和 HTTP；受控宿主响应不冒充实际宿主验收 |
| 同工作空间并发启动重复服务、跨空间任务/媒体或勾选串用 | `workspace-sharing.test.ts`、`workspace-runtime.test.ts`、`thread-selection.test.ts` | 实际打包 runtime、产品服务与 MCP；每例独立工作空间 |
| 工作空间改变后在途写入仍提交、媒体清理未结束即解锁 | `workspace-inflight-edit.test.ts` | 实际 HTTP/媒体边界、受控等待点；取消后核对数据库 |
| 心跳重复启动宿主、活动状态未知或切换后旧租约仍有效 | `workspace-heartbeat.test.ts`、`workspace-runtime.test.ts` | 真实长连接与受控宿主程序；关闭后恢复环境 |
| 往返工作空间导致后台制作任务丢失或重复提交 | `workspace-task-continuity.test.ts` | 实际 runtime/HTTP/MCP 与任务产物，保留原任务身份 |

这些测试直接使用 Vitest 的 `test`、`onTestFinished` 和必要的局部 spy，不依赖旧报告来判断业务结果。产品退出 helper 及其全部消费者在 #198 解耦，避免在本批复制进程出生身份逻辑；其专项包含正常、失败和取消退出。旧执行器和其专属测试已在 #200 统一删除。

开发时可直接运行 `npx vitest run tests/service.test.ts tests/mcp.test.ts`，或在上述文件中选择受影响场景。过滤和 watch 直接使用 Vitest 参数。迁入兼容原件、生产归档 fixture 和插件更新数据保障仍是产品测试，不属于可删除的旧执行协议。
