# 服务、runtime 与工作空间生命周期迁移（#180）

10 个文件、24 个原场景迁入既有 Vitest forks 串行基线；[逐项映射](scenario-map.json)保留 exact file/name/nesting，新增场景为空。原 HTTP/SQLite、真实 runtime/MCP/媒体进程、任务锁、跨工作树、重开任务状态和业务断言保留。清单仅变更这 10 项 executor，原范围不变；被测字符串中的 Node 入口保持原样。

各文件在注册前使用原生 `vi.setConfig({testTimeout:0,hookTimeout:0})` 保留未显式设置时限的 Node 默认；原30/60/120秒显式测试时限及业务轮询上限继续有效。Linux媒体崩溃例在任何资源/cleanup登记前调用原生ctx.skip保留原平台限制与报告原因。

配音/导出锁的 accepted 窗口使用原生 `vi.spyOn(globalThis,'setImmediate')`，只暂停生产任务的 global 回调时钟边界。仍创建并返回真实 Immediate 句柄，保留回调参数及原 native this；running阶段先恢复原函数，再在真实下一turn放行已到达的回调，cleanup同样先恢复/放行再关闭业务。当前生产代码不使用clearImmediate；Node timers/promises、Date、HTTP/MCP保持真实。原 `LOCK_WINDOW` diagnostic 改为原生annotation，仍保存outcome、phase、taskId与真实时间窗口。

诊断对照显示，直接以 `vi.useFakeTimers({toFake:['setImmediate']})` 替换 Node mock timers 在本批并不等价：原完整入口20通过/4失败，配音锁首例在accepted/running之后的modify HTTP超时，后三例首次modify即超时。独立纯时钟/纯business探针通过，最小真实HTTP配音探针则稳定在5秒探针时限失败；检查global及named/default/require Promise时钟引用均恢复，不能据此声称已证明某个内建导出引用损坏。改用上述真实回调gate后同一最小HTTP探针通过。原业务全部断言、30秒业务等待与60秒测试时限保留；这些探针只定位框架适配边界，不是性能证据。

原Node多个after按FIFO，Vitest onTestFinished按LIFO。资源依赖顺序明确为连接/客户端关闭、服务及拥有后代退出、删除目录；thread-selection将MCP客户端关闭登记在服务收尾后，实际LIFO先关闭客户端及后注册的表格连接。单个组合callback内部仍按原有await顺序执行。环境恢复独立提前登记，因此LIFO最后恢复host/PATH，即使后注册的资源清理失败也会执行；原值undefined使用delete，避免字符串undefined或前例污染。

thread-selection不再以固定300ms等待替代退出确认；workspace-runtime与task-continuity保留真实stop请求并新增既有 `serviceProcess` 出生身份与 `waitForServiceExit` 等待。workspace-sharing原服务身份登记与等待不变；service-exit-wait仍真实覆盖端口早关/迟到清理及超时只观察。崩溃导出例在活跃实例响应时登记service身份，并从仍匹配原service出生身份的真实父子边同步核对和登记全部后代；guardian marker只查询已有登记，不能从裸PID事后重新采样取得拥有权；发信号前核对原身份，等待已登记服务及媒体退出后才删除目录，未知身份保留现场。workspace-runtime的自有HTTP占位服务也await真实close完成。

本批没有共享完整node_modules的临时仓库；普通制作项目与真实Git工作树数据沿原轻量目录建立，不额外初始化依赖安装。逐例资源与环境恢复使用原生context，不增加自研宿主，也不改公共helper。

通过既有 `npm test -- --files <这10文件JSON>` 验证全部本批forks串行场景；原生报告、逐项位置及起止身份仍由既有协议核对。定向结果不替代固定候选完整验收，也不授予性能或并发资格。
