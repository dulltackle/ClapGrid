# 口播片段勾选、菜单、删除与拖拽的原生保障（#195）

直接运行 `npx playwright test tests/selection.spec.ts tests/delete.spec.ts tests/drag.spec.ts`；通过 `--grep` 过滤、`--debug` 调试。沿用 #193 的原生 `project` fixture：标准 Vite 面板、独立 HTTP/SQLite 服务及本例临时项目；browser/context/page、自动等待、失败 trace/截图由 Playwright 管理。两 worker、零重试、禁止 only；不引入字符串 App、客户端替换、CDP 输入桥、页面结果轮询或共享服务池。

## 产品保障承接

| 原独立故障 | 新场景与保留边界 |
| --- | --- |
| 鼠标单选、Control/Meta 多选、Shift 范围、checkbox/header 全选与半选；实际选择未同步 | selection 的宽窄参数场景，真实 `/api/table-selection` 响应与稳定 ID 请求；顺序和所选范围实际断言 |
| 详情、配音历史的只读操作偷偷改变选择；方向键影响范围；F2/Enter 接线失效 | selection 的只读详情/历史与表格键盘场景；实际 AG Grid 输入；音频真实播放由 #197 保留，非本票冒充已验 |
| 查找或勾选压缩表格/隐藏主入口、查找缩小全部范围、Escape误清选择 | selection 的 1600/420 宽几何与层级场景；查找后仍显示所有片段；菜单 Escape先关菜单，再由表格Escape清选；查找自身Escape仅关闭查找 |
| 实时删除已选身份后选择被全部清空或残留旧ID | selection 真实HTTP删除已选C，保留B，并观察本次table-selection响应确实只同步B |
| 勾选连接断开或同步失败仍沿用旧范围 | selection 直接释放本例 tableId 的真实长连接，恢复后新选择；实际同步 500 清空，再连服务后可用 |
| 部分勾选或查找被错误作为全片导出范围 | selection 的真实“导出全片”提交检查，不携带选择或筛选参数；制作结果/真实媒体由现有产品测试及 #197 承接 |
| 多选误允许相对插入、编辑时系统右键被业务菜单截获、动态锁导致焦点丢失 | selection 多选禁用上下插入；真实外部客户端 beginEdit 动态禁用全部菜单/拖动；真实textarea contextmenu观察保持default未阻止 |
| 右键已选行扩大/缩小范围，右键未选行却作用旧集合 | delete 的宽窄场景：固定2个目标、取消保留；未选C改为单目标，真实请求只含C |
| 菜单/删除框主题、键盘循环、安全初焦点、右下边缘不可达 | delete 的1600/420宽及360高场景，真实鼠标、Home/End/Arrow/Enter/Space、Tab/Shift+Tab/Escape；保留亮色/边框/危险色/可见键盘轮廓与32px按钮 |
| 菜单→确认提前回表格或滚动；返回详情入口后方向键失效 | delete 用真实focusin观察交接中没有表格焦点，取消恢复同一详情入口，再真实ArrowDown到相邻行；直接菜单关闭恢复原列 |
| 确认随外部修改/删除或勾选变化替换目标，误删新内容 | delete 确认捕获后真实释放本例tableId令选择清空，再经HTTP修改A/删除B，仍提交原完整快照并反馈changed/deleted；保留C；业务数据库事务与锁分支继续由 organization/modification/relative-insert 原生测试覆盖 |
| 确认按钮动态禁用仍能提交、禁用失焦 | delete 真实外部修改权令确认disabled，焦点安全回取消、opacity最终0.5；Enter取消不写入。旧慢CSS过渡专属重复矩阵合并为原生toHaveCSS自动等待 |
| 明确失败或已提交响应未知自动重试 | delete 两种真实边界：500未受理与route.fetch提交后abort；检查原项目/已删结果及单次请求，不把unknown当未提交 |
| 等待已发删除时取消撤回业务请求、迟到成功抢新界面/焦点，原来源被删不恢复 | delete 真实JSON gate；取消后查找不被夺回，或停留原片段时删除后恢复相邻行并继续键盘；旧返回帧遇新空白点击不执行 |
| 迟到删除成功/失败改变新查找、手动滚动或新勾选 | delete 两结果参数场景：真实新选择、搜索、wheel后才放行；结果仍正确，查找/焦点/滚动与B单选保持 |
| 来源虚拟卸载后取消丢焦，空表误回不存在行 | delete 60行真实重排卸载来源DOM，取消定位同一ID；外部清空后返回更多后备 |
| 多选拖动顺序丢失、未选中行误带旧集合、排序头打乱项目顺序 | drag 1600/420宽真实pointer路径，移动2/4保持组内顺序；未选6只移动6并选自身；列标题点击不排序 |
| 拖动 no-op/Escape/自身目标仍写项目 | drag 同一已确认顺序下各自真实输入，插入线退出且不增加修改请求 |
| 松手预览被取得权/轮询/响应等待覆盖，失败不回滚 | drag 分别 gate真实长连接申请与JSON响应，受理前SQLite仍原顺序而DOM立即预览；成功确认后下一次500回滚已确认顺序；2/8行重复矩阵合并为此因果场景 |
| 拖动期间新锁/外部顺序变化被覆盖 | drag 两参数：真实另一个修改租约或真实HTTP重排，页面观察变化后松手，原拖拽无写请求、明确反馈且服务数据不被覆盖 |
| 虚拟滚轮后静止指针仍用旧目标 | drag 1600/420宽100行，真实mouse down+wheel，不再move；系统命中行变化、插入线ID/placement随帧更新，松手后真实SQLite顺序对应新目标 |
| 边缘自动滚动被普通dragTo冒充 | drag 上/下边缘两场景，420×420真实按住鼠标移到32px边缘，轮询真实scrollTop跨200px；回中部停止滚动，读取当前真实行并松手，校验稳定身份位置和片段总数 |

八个旧字符串文件 `selection-panel`、`row-selection-panel`、`row-menu-panel`、`selection-menu-panel`、`delete-confirm-focus`、`drag-panel`、`drag-feedback-panel`、`drag-scroll-panel` 删除。共享 editing-fixture/旧浏览器 helper 已在最后消费者退出后由 #200 删除。原生配置的 `.spec.ts` 收集不依赖旧清单；旧清单、styles:check 等遗留调用已由 #200 统一退出，不提供旧命令兼容层。

## 范围与证据

本票只迁移测试，不改产品代码、不更新插件或实际宿主。现有口播片段素材/配音关联及持久化事务由有效 Vitest 产品测试保留；不为了测试数量重复重建旧故障矩阵。正式运行日志和失败附件路径由本轮仓库外运行记录保存；初轮真实失败用于修正与真实服务不一致的旧夹具预期，不删除产品断言。性能对照只用用户确认的前后各1轮，定向开发迭代不作为额外性能样本。
