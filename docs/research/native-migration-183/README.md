# 缓存、浏览器准备与UI检查命令迁移（#183）

本批5文件71个原实际场景：browser-build-cache 39、browser-startup 2、node-compile-cache 10、ui-check-plan 8、ui-check-runner 12。唯一清单仅改变本批5项executor，原scopes与38业务Playwright文件保持。沿用forks单worker、文件串行、isolate及零重试；原子发布回归内部原有3个真实worker保留，不表示测试文件取得跨执行者并发资格。

[逐场景映射](scenario-map.json)与历史实际file/name/nesting逐项对应，原业务场景无增删。原共享缓存场景补充两个实际构建夹具.cache/.vite/.vite-temp/.vitest-cache同名写入互不污染且不写共享安装的断言，新增断言单列，不用数量增长掩盖原覆盖。

## 原生生命周期与依赖隔离

各迁移文件注册前使用vi.setConfig({testTimeout:0,hookTimeout:0})保留原Node未显式限时默认；browser-startup每例3000ms与80/1500ms端口等待、UI CLI15000/20000/30000ms以及缓存进程等待原窗口保持。

browser-build-cache的beforeEach直接使用Vitest原生context.onTestFinished，移除Node TestContext强制转换；每例缓存目录与CLAPGRID_BROWSER_BUILD_CACHE_DIR逐例恢复。原生LIFO先等待本例编译child close、回收输出目录，最后恢复环境并删除缓存目录。所有真实异步编译child在创建时保存close Promise，失败回收时先kill本次child再await原close，之后才能删除资源；没有按命令名终止其他进程。Node diagnostic改为await官方ctx.annotate并进入原生来源。UI runner的CHROME_BIN/BROWSERSLIST环境恢复同样逐例登记，不依靠文件结束恢复。

真实buildRepository、重建安装视图的工具/配置故障夹具、Node UI字节码与UI runner临时仓库使用#175公共dependencyView，统一使用公共8aebe4d修复，预建本地.cache/.vite/.vite-temp/.vitest-cache并排除对应共享软链。故意修改的esbuild/tsx等工具先realpathSync解析共享包根，再复制真实目录成夹具本地副本，并在变造前断言本地与共享realpath不同；不能直接cpSync软链入口，以免复制出仍指向共享安装的软链。外部包目标切换、断链/环链、权限、源码路径别名等被测链接保留，不能当依赖视图重写。

## 真实执行与政策边界

保留真实esbuild/CSS/Vite的冷/热执行、源码与配置变化、工具字节/环境/资源变化、未知或损坏缓存重建、原子发布及真实取消/强杀反例。热命中后继续执行原产物或观察实际输出，Node字节码冷/热、恢复mtime改源码和损坏缓存仍核对真实副作用。冻结旧指纹语义夹具与所有Node原生测试器/TAP字符串保持原版本含义。

UI plan/runner仍核对选择范围、预期集合、缺浏览器失败、业务UI skip/todo拒绝、源码失效、取消和失败清单；用于命令编排的原CHROME_BIN替身与真实Node fixtures不变，不将它们冒称为本次真实Chrome页面验收。未修改生产执行器、预检顺序或Playwright代码。

公开`npm test -- --files`选择本批5文件保存原生及统一逐项证据；`npm run typecheck`提供类型检查。首切片TDD以browser-startup2例通过原CLI证明只改清单时node:test输出不能冒充Vitest收集，迁移后同入口通过。局部通过不代替父规格最终固定提交正式验收或性能采用结论，未涉及插件安装及实际宿主交付。
