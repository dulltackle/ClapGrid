# 原生导出拒绝与产品进程退出检查

Linux 专项直接执行 `node scripts/verify-speech-export-processes.mjs <本轮输出目录>`。脚本用 strace 启动 `vitest run tests/speech-export-lock.test.ts --reporter=json --outputFile <本轮目录>/vitest.json`；消费框架原生的通过状态和 `meta.exportRejectionWindows`。没有旧执行身份、报告认证或格式转换层。

| 独立产品故障 | 保留的真实保障 |
| --- | --- |
| 配音 accepted/running 时错误允许导出 | 成功、明确失败、中断三种任务各自两个 HTTP/MCP 拒绝窗口；表格重连后仍拒绝 |
| 批量等待中的任务被当作空闲 | 第七个 queued 窗口，固定配音任务和拒绝结果 |
| 空追踪被误认没有媒体进程 | 必须捕获窗口前实际成功 exec 的导出 FFmpeg；每个窗口内拒绝任意 exec |
| 依赖缺失、权限错误、未执行、跳过或报告缺失被当作成功 | strace/ffmpeg/ffprobe/字体预检、真实 tracing preflight、非零退出传播、四例全部通过和七个非空业务窗口；失败写入原始日志并退出 1 |
| 端口关闭后项目仍被服务/媒体使用 | `service-exit-wait.test.ts` 等待进程真实结束再检查迟到清理记录；超时保留现场且不强杀 |
| PID 被复用或身份未知时误伤另一进程 | 本例出生身份包含 Linux namespace、boot id、start time；不同出生身份不认领，未知身份不能视为已退出 |
| 服务正常退出、崩溃、取消后媒体未收尾或重开错误恢复 | `lifecycle-export.test.ts` 保留真实服务、媒体子进程、信号、中断恢复和本例目录清理；产品专项未换成模拟进程 |

`tests/helpers/product-process.mjs` 仅提供具体产品进程出生身份和只读存活检查；`service-exit.ts` 负责有界等待，不拥有后台检查、任务登记、工作树或通用生命周期。迁入测试（含生成的宿主）、共享工作空间启动观察器、媒体退出测试以及所有 `service-exit.ts` 消费者使用此实现。只有确认本例拥有的服务/媒体进程结束后才删除目录；身份未知时继续保留现场。

日志使用 `tests.log`，窗口与原始框架结果在 `vitest.json`；`exec.trace`、`preflight.log`、`result.json` 和 `summary.md` 用于该产品专项诊断。它们不是新的统一测试报告。供应商响应受控，不冒充实际供应商或已安装插件的宿主验收。

CI 的 `process-trace.yml` 继续在每个 PR、main push 和手动执行；未移到定期任务或合并后。主检查与必要进程专项分别执行，前者验证保留的完整产品集合，后者增加 Linux 系统调用观察。
