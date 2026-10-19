# 制作文档、引用与审阅证据迁移（#177）

10 个原 Node 文件迁入既有 Vitest forks 串行基线，共 296 个原场景；[逐项映射](scenario-map.json)保留 exact file/name/nesting，新增场景单独列为空。唯一清单只变更这 10 项 executor，原 scopes 保持不变。

各文件使用原生 `test`、`TestContext.onTestFinished` 和文件级 `vi.setConfig({testTimeout:0,hookTimeout:0})`，保留原 Node 未显式设置时限的语义。每例只有一个目录收尾回调，不存在 FIFO/LIFO 相互依赖；真实 CLI 与 ffmpeg/ffprobe 都在同步返回后才清理。编码项目、中文/空格路径及原历史包均保留真实文件操作。单次 child env 的 PATH 设定保留，不改进程全局环境。

模板升级例的 kit 使用 #175 公共 `dependencyView`，保持原 kit/templates 与两个制作项目布局，依赖包继续共享读取，.cache/.vite/.vite-temp 留在本例私有目录。其他普通制作数据目录沿原逐例删除，不强加 Git 或依赖视图。

外层宿主迁移不改变制作 CLI 的 Node 进程、媒体处理、历史 Python 版本归档及其原字节含义。证据复用、来源身份、earned/writeBackAllowed、机械核对与实际确认的边界和全部原断言保留。标题中的“真实 Node 入口”继续指被测 CLI。

从既有 `npm test -- --files <这10文件JSON>` 执行全部本批场景；原生报告、失败位置、起止源码/配置/环境身份和完整原来源继续由既有适配器校验。类型检查及定向结果只证明本批，不替代父规格的固定候选完整验收，也不授予并发资格或性能收益。
