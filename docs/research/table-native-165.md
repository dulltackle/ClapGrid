# 表格编辑与选择场景原生执行（#165）

本批将 11 个文件的 36 个既有场景交给 Playwright fixtures，初始基线为 `2a5bcc4`。范围为文案编辑、长文案、粘贴、搜索、行菜单、行与范围选择、选择菜单、拖拽及滚轮反馈；不吸收 #166 的添加/独立焦点、#167 的媒体/导出面板或 #168 的特殊构建与主题批次。行菜单原本包含删除确认和焦点交接，作为同一原场景完整保留，不拆掉其断言，也不迁移后续批次文件。

[逐场景映射](table-native-165-map.json) 保留原文件/名称、候选相同身份、原 scope 与原文件哈希及模板字面量保持记录。迁移仅改变测试注册、执行者归属及 fixture 调用；用 AST 对全部模板字面量做逐字节对照，包括每个内嵌浏览器脚本、fixture.replace 和运行时构造 slowTransitionScript/boundary 的字面量。原页面脚本中的等待、断言、AG Grid、主题检查、真实 CDP 键鼠输入均保留。原测试回调中除缺 Chrome 的防护外的断言也保留。

## 生命周期和执行边界

全部场景使用已验证的 `tests/helpers/playwright-browser.ts`，worker 复用真实 Chrome，每个 `panel.check` 建立独立 context/page、DOM、storage 和临时目录。业务替身仍仅在原 HTTP client 边界，以独立页面模块状态重建，不共享场景后端状态。生产同源 CSS、实际输入、源码校验和准备缓存保持已验证路径，缓存命中仍执行脚本与操作。没有引入本批未使用的夹具接口。

原每例 15/30/40/60 秒测试超时显式迁为 `test.setTimeout`，未放宽。`editing-panel` 原 dump-dom helper 的窗口请求为 `1600×1200`，候选显式采用该视口，其他场景保留原宽高及默认 `1600×1000`。editing 从 Chrome 独立进程的 `--virtual-time-budget=10000` / 25 秒 execFile 上限转为同一原脚本真实时间执行、原 30 秒测试上限及共享 fixture 的结果等待；不删除脚本等待，不靠延长超时提速。原独立进程内的编译路径改为已用且校验实际输入的标准 buildBrowserScript，Node 环境和业务 fixture 定义继续为原开发同源内容。

移除本批全部 Node 测试注册、chrome skip/局部断言与旧 helper imports。缺浏览器由 fixture 直接失败，不能跳过。`checkBrowser` 仍被后续 export-settings 文件使用，interactive-browser 仍被后续批次使用，保留它们及已有专项，不能为了删除代码破坏未迁移场景。当前默认并发仍为 1；worker 在文件间复用，文件内串行，不申请未经验证的并发放宽。已有 UI 快检的安全并发条件和未知范围降为 1 的政策不变。

## 公开入口、完整清单及保障

`test-inventory.json` 仅改变本批 11 处 executor 为 playwright；文件身份、all/rows scopes 与 UI policy 原样保留，Node 不再重复执行它们。行菜单、编辑、长文案及拖拽滚轮等原 rows 成员继续进入预检，现有私有累计账本继续引用当次原始证明，在完整 PR 检查不再重复执行。`ui-check-plan.mjs` 的组件到文件映射沿用同一文件身份，公开 UI/相关入口按当前 inventory 调度新执行者，无需新建另一套映射。

公开 `test-runner.mjs --suite ui --files [...] --concurrency 1` 覆盖本批全部场景。原 #163 的缺浏览器、skip/todo、零收集、失败/收集错误、不完整/损坏报告、错误身份、取消及资源归属故障回归原件保留；本批未改变对应的 fixture、校验器或 reporter 实现，严格 UI 仍逐例要求 passed、retry 0。最终固定候选由 #172 重跑完整适用检查；此处的开发定向不升级为最终验收。

## 测量与原始证据

代表热点使用 search-panel 的三个原视口，迁移前后各三次相同公开命令、相同工作树与锁定依赖，默认并发 1，显式关闭 Node 字节码和浏览器构建缓存，BROWSERSLIST_IGNORE_OLD_DATA=true。协调者为每组预留无并发检查窗口；两组期间没有改变浏览器脚本、断言或视口。wall-clock 包括入口身份采集、真实构建/Chrome/操作/报告/清理；没有用场景耗时相加冒充完整入口耗时。

原生报告、逐例版本/位置/nonce、各次源码与环境身份、timings 和执行命令保全在本次运行记录的 `measure-165-before/` 与 `measure-165-after/`。这些是代表性定向热点测量，不能冒充完整 check、UI 类型/构建全入口或 CI 性能对照。完整范围收益由 #172 另行测量。

公开类型检查通过；本批11文件36场景全部实际passed、retry 0。真实报告验证36个独立context/page/目录，单worker复用Chrome，全部context关闭，目录删除，实际宿主worker/Chrome精确PID均不存在。TDD公开入口契约先因旧执行者为Node失败，候选同场景由Playwright实际通过。

搜索热点迁移前三次为 43.813 / 43.586 / 43.551 秒，中位 43.586 秒；迁移后三次为 43.839 / 44.004 / 43.848 秒，中位 43.848 秒，变化 +0.60%。每轮三个视口、实际脚本 bundle 和 CSS 字节身份完全相同，缓存确实关闭。本代表热点未证明可重复加速；不删减原等待来制造收益。单worker复用和原生收集已贯通，完整PR收益与后续安全并发仍由#171/#172验证。

上述为未提交开发内容的定向证据，源码起止身份与原始报告原样保存；测试完成后补齐文档/映射，不伪装重新执行，也不宣称固定候选正式通过。独立OCR和最终提交身份由本次运行记录补齐。
