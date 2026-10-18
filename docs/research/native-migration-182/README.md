# 原生执行报告与完整性工具测试迁移（#182）

Vitest适配、Playwright适配、统一证据、Node报告、源码检查五个外层测试文件迁入统一forks串行宿主。唯一执行者清单只改变这五项owner，原all/tooling等范围不变。没有删除Node执行适配、Node报告器或历史兼容路径：嵌入的真实Node测试器、TAP、报告器和冻结旧版执行器仍是明确调用的验证对象。

[场景映射](scenario-map.json)将历史真实80个原场景与#176既有12个新增宿主回归分开记录，共92项；本票没有新增替代场景。历史原件和已结束报告只用于对应，不能当成本轮通过证据。原所有断言、场景名称/nesting、错误注入、子进程命令、NODE_TEST_CONTEXT清理和原测试平台限制保留。

## 原生迁移与资源顺序

五文件在测试/hook注册前用原生`vi.setConfig({testTimeout:0,hookTimeout:0})`保留Node外层未限时语义，显式10/20秒测试时限和被测子进程15/60秒等时限原样保留。Vitest的配置、普通CLI和预加载API仍为forks、单worker、文件串行/isolate、零重试；不取得跨执行者并发资格。

只通过AST定位外层node:test import、TestContext与真实context.after/diagnostic调用，不解析或替换被测字符串。原字符串中的node:test、动态t.test、TAP、Node reporter以及原生skip/todo继续实际在子进程执行。源码检查child继续从当前物理模块读取code-check-v1，配置、资源、二进制、未知路径、文件变化和工具环境失效反例均保留。

原Node多个after为FIFO，原生onTestFinished为LIFO：repository目录清理先登记，后来登记的拥有者停止/等待回调先运行，随后才检查活动锁并删目录。Playwright三个显式取消例原SIGKILL兜底继续作用于本例ChildProcess对象，并等待其原closed promise，避免启动清理后立即删fixture；活动检查锁仍存在时保留现场并报错，不用终端退出推断全部Chrome后代已结束。Vitest跨工作树取消例保留原finally stop和等待，另一工作树独立继续运行的断言不变。

九处外层diagnostic改为`await ctx.annotate`，原JSON内容不变，进入原生逐例annotations并由现有reporter保存；同步callback只为等待原生注解完成而改为async。没有新建通用测试宿主、包装框架或第二个测试专用入口。

## 真实反例和来源

原公开命令继续验证三种实际执行者及其原始报告：零收集、only、缺失/截断/篡改原始报告、错nonce/源码身份、漏文件、重复归属、收集/未捕获异常、源码变化、严格UI skip/todo/缺Chrome，以及进程取消、锁、HTTP媒体端口、Chrome/profile/context/目录清理。退出零不能替代当前完整证据，失败位置与集中复验范围仍由原生来源产生。

#176三路径forks/isolate/文件串行、bootstrap在源码闸门前后无IPC而fork worker保留原生IPC、逐例mock/env恢复、beforeEach清理、动态跳过原因、异步/测试/清理时限反例全部继续执行。普通与预加载使用原有公开入口，没有将这些子进程验证替换为外层断言。

本票从独立工作树开始，在任何检查前建立只读包链接和本地.cache/.vite/.vite-temp/.vitest-cache的稳定dependencyView；运行期间不切换依赖视图。适用的Vitest/Playwright repository、跨工作树取消例other及三处Node原生对照fixture也复用既有dependencyView，包只读共享，四类可写缓存预建在各自fixture，首次写入不改变安装拓扑；CLI trap重建安装目录时递归删除本地视图并排除四类缓存再复制包链接，原vitest/dist只读包链接和故意缺Chrome/来源攻击链接保持原意。`CLAPGRID_VITEST_TEST_EVIDENCE`与`CLAPGRID_PLAYWRIGHT_TEST_EVIDENCE`沿既有可选归档保存实际fixture原报告、日志和原路径origin.json，不改写原来源。

使用原`npm test -- --files '["tests/vitest-runner.test.ts","tests/playwright-runner.test.ts","tests/test-evidence.test.ts","tests/test-reporting.test.ts","tests/check-source.test.ts"]'`与`npm run typecheck`。先验证只改归属而未迁移Node外层时公开入口因零收集拒绝通过，再迁移Node报告外层获得两项真实子进程绿灯。局部通过不升级为最终固定候选验收、性能收益或实际宿主交付；完整正式验收留待父规格稳定集成。
