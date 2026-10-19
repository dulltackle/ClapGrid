# watch 检查宿主迁移（#185）

单个完整文件的 39 个历史原场景迁入 Vitest forks 串行基线，另保留 #175 新增的 1 项公共夹具回归。[场景映射](scenario-map.json)逐项保留原 file/name/nesting；全部真实 Node/TAP/Playwright 字符串夹具、长驻 watch、Chrome、锁和报告故障注入保持原样。

仅更换外层注册及原生 context：onTestFinished 对接 #175 公共临时仓库清理接口，diagnostic 改原生 annotation。文件级 testTimeout/hookTimeout 为 0，保留原 Node 未显式限时；原业务等待、CLI 时限、取消和清理上限不改。仍使用公共包读取视图及同步 withEnvironment，缓存目录逐仓库隔离，真实独立 Git 工作树继续真实验证。

Vitest 收尾按 LIFO：共享包目录先登记、两个夹具后登记，因此夹具退出与删除先于共享目录。两项上游拥有者取消场景先创建被检查仓库，再创建上游仓库，使上游原进程 close 与后代收尾完成后才删除被检查仓库。其他独立夹具互不依赖，单个公共清理回调内部仍等待原 child close、原生命周期 stop 与锁回收后才删目录；失败保留现场。

采用既有 npm test -- --files 入口执行完整文件及类型检查，保留原始报告与逐项来源。定向证据不替代后续固定提交完整验收，不证明性能或并发资格。

诊断原完整入口出现watch重启，保全原件显示外部写入 `node_modules/.vitest-cache`。公共依赖视图遗漏该Vitest可写缓存时，按包链接把它暴露给临时仓库；受控外部写入可在真实watch中稳定重现restart-required。公共接口改为启动前建立四类本地缓存目录（另三类是.cache/.vite/.vite-temp），排除对应共享链接；原隔离回归同样涵盖四类缓存。预建拓扑也避免第一次构建创建缓存目录后使依赖指纹变化。真实依赖变更仍要求重启，未放宽watch输入规则。
