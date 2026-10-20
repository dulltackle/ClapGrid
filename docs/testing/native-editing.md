# 口播片段编辑的原生测试承接（#193）

本批直接运行：

```sh
npx vitest run tests/project-editing.test.ts tests/relative-insert.test.ts tests/editing-service.test.ts
npx playwright test tests/editing.spec.ts tests/segment-draft.spec.ts tests/paste.spec.ts tests/insert.spec.ts
npx vitest tests/project-editing.test.ts
npx playwright test tests/insert.spec.ts --grep '第二次修改权' --debug
```

Vitest 按 `tests/**/*.test.ts` 收集，Playwright 按 `tests/**/*.spec.ts` 收集。迁移期间其他批次尚存的旧浏览器 `.test.ts` 不属于本批定向检查；到 #200 清除旧文件后再执行全套原生收集。没有第二份执行清单或旧入口转发。两套配置均禁止 only、零重试、空收集失败。浏览器使用 `CHROME_BIN` 明确指定的程序；未设置时使用本机 Chrome。

`tests/helpers/project.ts` 通过原生 worker fixture 将标准 Vite 生产面板构建到临时目录，每例启动独立真实 HTTP/SQLite 产品服务。browser/context/page、失败截图和 trace 由 Playwright 管理。项目服务正常关闭后才删除本例项目，worker 结束后删除其面板目录。`holdResponse` 只控制真实 JSON 响应何时到达页面；`holdRequest` 控制长连接申请何时发送，不读取完整长连接响应，不替换客户端或事务。

## 独立故障承接

| 原保障 | 承接 |
|---|---|
| 行内提交、取消、多行与组成事件兼容、保存重载后保留 | editing.spec：保存重载、Escape/Shift+Enter；合成 composing 事件只代表 editor 兼容，不冒充系统 IME 验收 |
| 原行保存后一次点击进入相邻行；租约先关闭仍等待保存响应 | editing.spec：相邻单击；真实 route.fetch 提交后延迟返回 |
| 编辑者互斥、失效 token 不得覆盖、真实 HTTP/SQLite 文案保存 | editing-service.test；关闭页面释放修改权由 editing.spec 验证 |
| 连续设置保存、查询刷新仲裁、迟到 lease/apply/error/close 隔离、未知结果不重试 | 已有 project-editing.test 的 7 例直接保留，删除重复 node:test 的 project-editing.native.ts；设置表单特有 UI 由 #197 承接 |
| 详情文案和画面说明保存失败保留原草稿/确认/来源；成功后才进入目标 | segment-draft.spec 两种字段参数测试；真实 HTTP 500 后重新提交 |
| 详情草稿断线后禁止覆盖外部新内容、删除后 readonly 可复制 | segment-draft.spec：服务关闭/同端口同项目重启，再用真实公共 API 外部修改/删除 |
| 内部浏览保留原来源，表格成功导航提交新来源 | segment-draft.spec：鼠标及真实 Enter 激活、关闭后方向键继续 |
| 保存继续中的新操作取消迟到导航；离开再回父容器不能复活旧修改权 | segment-draft.spec 两个异步场景；第二次 lease 最终由服务状态确认已释放 |
| 粘贴过滤空行、空提交禁用、成功清空、错误保留全文并释放修改权 | paste.spec 正常与失败重试；editing-service.test 经过真实 HTTP 校验顺序和空行 |
| 粘贴申请中/提交中不能重复或关闭；模态键盘与窄矮可达 | paste.spec 两个 gate、Tab/Shift+Tab/Escape、遮罩、1600×1000 与 420×360 |
| 普通新增顶部/底部/更多入口、清查找、仅选新 ID、直接编辑、关闭返回 | insert.spec 三入口参数化，真正触发完整页面流程 |
| 相对上方/下方插入位置、真实右键/键盘、选择新 ID、保存新文案 | insert.spec 420×800 两种方向，经过真实客户端、schema、HTTP 和 SQLite |
| 锚点/顺序过期不误插入，失败事务回滚，不破坏媒体与有效配音，任务锁 | 已有 relative-insert.test 的 6 个实例保留；insert.spec 一条真实 HTTP 冲突及错误焦点反馈 |
| 外部修改权禁用新增及粘贴 | insert.spec：真实第二客户端 beginEdit，释放后恢复 |
| 创建响应迟到与创建后二次修改权是不同窗口 | insert.spec 普通/相对两个参数组分别 gate JSON 响应、第二次长连接申请；查找/键盘/租约释放实际断言 |
| 普通新增已接收结果但释放尚未返回的窗口 | insert.spec：gate 真实 release JSON 响应，用户查找后不继续旧导航 |
| 明确失败不制造行、不改新查找；已提交响应未知不自动重试 | insert.spec 明确失败普通/相对两例，以及 route.fetch 后 abort 的真实数据只新增一次 |
| 离页后的旧成功/失败不覆盖后续详情、焦点、新租约或新成功状态 | insert.spec 两种结果；pagehide/pageshow 为生命周期事件接线测试，真实页面关闭释放另有实际 page.close 检查 |
| 真实滚轮取消已定位的新增后续编辑 | insert.spec：80 行虚拟表格、第二次修改权 gate、真实 wheel；滚动保持且新 lease 释放 |
| 精确帧取消、后备可用性、重排/删除、虚拟卸载、父子层来源及最上层保护 | 独立焦点子集由本批 focus.spec 及具体模块 fixture 承接，随最终集成统一记录 |

旧 `editing-panel`、`segment-draft-panel`、`paste-panel`、`relative-insert-panel`、`relative-insert-lifecycle-panel`、`ordinary-add-focus-panel` 字符串测试删除。多个输入事件与全部时点交叉产生的旧矩阵按共同故障后果合并，不要求保持旧数量。普通新增/相对新增都保留创建与二次租约两个不同因果窗口；查找、键盘、真实滚轮、离页及新模态的接线由代表场景和焦点子集共同覆盖。共享旧浏览器/字符串 fixture 尚有其他批次消费者，暂不删除。

本批没有更改产品交互或安装插件。原生受控测试只能证明源码行为，不能作为安装包或实际宿主加载成功证明。性能报告采用用户确认的前后各 1 轮，报告实际变化；本批开发过程的 npm ci 与定向迭代不是性能样本。
