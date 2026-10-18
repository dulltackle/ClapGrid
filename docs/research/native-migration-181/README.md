# 插件命令、构建身份与发布契约迁移（#181）

本批9文件24个原场景：agent-tools 7、build-identity 2、diagnose-identity 3、linux-components 4、panel-release 1、plugin-source-update 3、plugin-update 1、process-trace-command 1、review-contract 2。唯一执行者清单仅改变本批9项executor，原scope不变；沿用forks、单worker、文件串行、isolate和零重试，执行者之间仍串行。

[逐场景映射](scenario-map.json)以历史实际file/name/nesting为原件，24项全部同名对应，无新增场景。历史Linux样本为23passed+1skipped；Ubuntu24.04限定的安装基础工具场景保留平台条件及原原因，不能把普通skip改称实际执行通过。其他平台按原条件单列实际状态。

## 原生生命周期与隔离

所有迁移文件注册前调用原生vi.setConfig({testTimeout:0,hookTimeout:0})，保持Node未显式限时的默认；panel-release/plugin-update的60000ms专项测试时限保持。原Node diagnostic使用官方ctx.annotate，原生报告保存注解；静态平台原因改为资源创建前ctx.skip(reason)，Linux两处ready分支则先删除本次目录再ctx.skip，不让pending状态覆盖清理异常。

所有临时目录逐例回收；agent-tools原未回收目录也在创建后登记onTestFinished。build-identity根目录先登记、MCP客户端及直接ChildProcess后登记，原生LIFO保证客户端/真实service close完成后才删除目录。panel-release先关闭table，再由原runtime workspace-status/stop控制通道停止本例实例；plugin-update同样停止本例真实外部服务。两者在实时open/status响应时按instanceId登记并立即保存服务出生身份，最终用已有waitForServiceExit核对本次进程退出，移除原吞错及固定200/300ms等待；归属、停止或退出未知时抛错保留根目录。worker内taskService由原finally关闭，不将process.pid当外部子进程等待。CLAPGRID_CODEX_BIN恢复采用嵌套finally，服务启动或关闭抛错也恢复原环境。

build-identity、panel-release、plugin-update三个真实临时源码安装视图使用#175公共dependencyView：包只读共享，.cache/.vite/.vite-temp留在本次目录；不改共享helper。技能软链接、面板路径逃逸软链接及Linux组件工具软链接均为被测输入，保持原样。

## 真实边界与交付范围

保留真实build-plugin包构建、MCP/HTTP服务、SQLite、runtime/update-plugin命令、收据及回滚验证；仅外部宿主/安装器沿用原隔离替身，market/cache/XDG_DATA_HOME全部指向临时根。未执行本机插件安装、实际宿主更新或发布。actual-host/actual-browser标签仍仅为原格式契约测试输入，不能当作用户实际宿主证据。

进程追踪命令专项仍只在PATH缺strace的隔离目录验证原失败诊断，不运行全局追踪窗口；独立Linux tracing工作流、全局拒绝窗口及生产命令未改。

通过既有`npm test -- --files`选择这9文件获取本次逐项原始报告，类型检查仍为`npm run typecheck`。TDD首切片先仅改归属，公开入口拒绝node:test实际TAP但Vitest零收集；迁移后同一真实进程追踪命令场景通过。原始结果由运行记录保存。本批局部通过不代替父规格最终固定候选完整验收、性能采用结论，也不证明安装包或实际宿主已更新。
