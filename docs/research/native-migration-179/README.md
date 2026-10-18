# 画面素材、导出任务与配音保留测试迁移（#179）

项目导入2项、视频画面素材6项、视频服务1项、导出任务17项、配音保留5项，共5文件31个原场景改用Vitest原生宿主。名称、nesting、全部原业务断言及唯一all归属保留；不扩大logic/service或预检范围。[逐项映射](scenario-map.json)以历史完整正式原报告的真实case为原件，不能作为本轮执行证据。

全部文件在注册测试前调用原生`vi.setConfig({testTimeout:0,hookTimeout:0})`，保留Node原未设置测试/清理时限的无限语义。项目导入竞争例原显式timeout:20000保留；原业务轮询60秒、配音与任务等待窗口均保留，不靠框架默认5秒截断有效慢媒体操作。沿#176统一forks、单worker、文件串行隔离、零重试；执行者之间仍串行。

## 真实边界与清理依赖

FFmpeg/FFprobe编码、解码、媒体像素/能量/包时序、素材文件、真实HTTP/MCP、SQLite触发器及任务取消/结果保留全部继续实际执行。被测host脚本、媒体worker和CLI子进程源码字符串未迁移为Vitest。

Node多个t.after为FIFO，Vitest onTestFinished为LIFO：目录先登记、随后登记业务/服务关闭，原生逆序在删目录前等待关闭；视频服务按编辑连接→client→MCP→service→目录依赖顺序释放，初始化或断言失败也有原生清理。视频与配音保留重开数据库前显式await close，关闭状态标记避免重开失败时重复关闭旧句柄。导出ready保留本业务close的Promise去重，提前登记目录，FFmpeg准备失败也能回收。

导出取消清理例使用`vi.spyOn(fs,'rm').mockImplementation`替代原Node mock.method，仍只暂停本任务真实工作目录删除，真实remove继续执行。原finally resume保留；逐例hook再次resume并mockRestore，随后才关闭业务和删除目录，避免失败时清理死锁或将替身泄漏给下一例。独立新增1项回归验证下一例fs.rm已不再被mock且真实临时目录确实删除；新增项不填充31项原业务覆盖。PATH修改继续finally恢复，原值缺失时删除该变量而非写入字符串undefined。

项目导入CLI重开服务：停止HTTP端口后使用既有原拥有者身份工具等待实际服务退出，再删除临时项目；竞争导入例在原20秒测试时限下保留SIGKILL中断行为，逐例等待原execFile promise结束、让本次host fixture原子保存自身完整出生身份，父测试和清理只消费原身份，kill前核对当前pidNamespace/boot/start，不从旧marker的裸PID重建归属，核对并停止原拥有者后等待退出，未知或失败时保留目录且报告清理失败，不以端口关闭或外层命令退出代替进程退出。

## 公开入口与证据边界

`npm test -- --files '["tests/project-import.test.ts","tests/video.test.ts","tests/video-service.test.ts","tests/export-tasks.test.ts","tests/speech-retention.test.ts"]'`通过同一清单收集、执行、报告本批31原场景及1个新增回归。逐项身份、失败位置和原生来源继续经现有统一校验器核对；`npm run typecheck`覆盖迁移源码。首个切片先验证只改清单未迁移Node宿主时公开入口拒绝通过，再迁移视频服务获得真实媒体绿灯。

本记录描述本票实现与覆盖边界；局部检查不升级为固定候选正式验收、性能采纳或并发资格。本票未修改共享ADR/协议、产品业务或插件安装包；正式候选验收由#174稳定集成后执行。
