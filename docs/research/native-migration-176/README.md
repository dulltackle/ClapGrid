# 统一 forks 基线与相对插入完整切片（#176）

唯一执行者清单承接19个Vitest文件：原18文件86场景，加相对插入6场景。相对插入保留原all范围，不改变预检归属；执行者之间仍串行，Playwright沿原入口执行。配置、普通CLI与纯框架预加载公共API统一forks、单worker、关闭文件并行、保留isolate、零重试。

[逐场景映射](scenario-map.json)来源于历史完整正式原报告的实际case，原18文件与相对插入逐项同名同nesting对应，共92项；该原件不是本轮通过证据。新增工具回归另记，不用新增回归数量填充业务原覆盖。

## 原生生命周期约定

新迁移的相对插入在任何test/hook注册前调用原生`vi.setConfig({testTimeout:0,hookTimeout:0})`，保留原Node文件未显式设置时限的无限默认。其业务轮询10秒上限继续保留。既有18个Vitest文件维持原默认5秒test/10秒hook和各自显式时限；其他迁移文件的显式test options.timeout仍优先。原生isolate保证文件级配置不外溢。

Node多个`t.after`默认FIFO，Vitest `onTestFinished`为LIFO，不能机械替换顺序。相对插入原本每例用一个回调按business.close→删除目录（回滚例为db.close→business.close→删除目录）执行；迁移先登记删除目录，再登记business.close，回滚例最后登记db.close，真实逆序保持相同依赖顺序。媒体例将目录清理提前到FFmpeg执行前，其他例提前到openBusiness前；初始化失败也能收尾。每个清理独立登记，一个清理抛错仍继续剩余清理，原生报告保持failed。

`beforeEach`可以用context.onTestFinished登记逐例清理，也可以返回原生cleanup；后者在afterEach之后、onTestFinished之前执行。原生回归核对下一例开始前资源、mock、环境、global和计时器均恢复，不能依靠文件结束或isolate代替逐例恢复。

Vitest 5.0.5动态`ctx.skip()`先设置pending，之后hook异常存在被skip结果覆盖的框架风险。因此有动态跳过决策的资源在调用ctx.skip之前用局部try/finally完成回收：先记录跳过原因，finally完成必要清理，成功后再ctx.skip(reason)。清理抛错会作为失败正常上报，不进入skip；不创建自研通用宿主，不把清理异常当成允许skip。静态平台限制使用原生注册选项，保持原政策和原因。相对插入本身无skip。

原Node diagnostic映射采用原生`ctx.annotate`，原生reporter保存annotations和动态skip note；嵌套改为原生describe/test注册，fullName、nesting及位置独立保存。异步拒绝、beforeEach/afterEach/清理失败、显式测试和清理超时均由公开入口真实执行并拒绝通过，保留原始stack/逐例身份、来源及零重试。

## 新增回归与IPC边界

`tests/vitest-runner.test.ts`新增12项外层工具回归，和原21项分开：三路径真实forks/isolate/文件串行；注解/skip原因/嵌套证据；逐例cleanup与beforeEach及mock恢复；文件级零时限和下一文件默认时限隔离；七种真实失败；Node FIFO与Vitest依赖清理及执行者串行对照。原零收集、only、未捕获异常、取消、原报告损坏/集合缺口/nonce及源码读取边界反例全部保留。

原“纯框架预加载与实际源码读取重叠，释放后不遗留IPC语义”回归保留外层身份：在隔离fixture的真实bootstrap创建fd3管道前、barrier放行后/startVitest前分别断言process无IPC属性，要求两次原始观察完整；测试worker同时明确验证forks原生IPC存在。这样既保留普通管道预加载边界，也不关闭fork worker原生IPC。原Linux /proc重叠、源码闸门、未知NODE_OPTIONS保守启动及取消清理反例仍执行。

## 使用与证据

`npm test -- --files '["tests/relative-insert.test.ts"]'`执行六个原业务场景。既有`test:logic`/`test:service`继续覆盖11/7文件59/27场景；公开`npm test -- --files '["tests/vitest-runner.test.ts"]'`执行全部宿主工具回归。局部通过不升级为固定提交正式验收、并发资格或性能收益。本票保持串行；完整固定候选验收由父规格稳定集成后执行。
