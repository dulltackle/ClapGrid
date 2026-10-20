# 布局、检索与面板刷新原生测试

本批使用 Playwright 原生 page、locator、expect、trace 和失败截图；项目来自真实 HTTP/SQLite 服务，表格为真实 AG Grid。默认无重试，无跳过。主题只核对产品采用的亮色契约，不增加未支持的暗色模式。

| 旧保障与独立故障 | 承接位置及边界 |
| --- | --- |
| search：连续匹配、大小写、按片段计数、全部命中、循环、关闭与重开、全部行保留、勾选独立 | `search.spec.ts` 三种宽窄/窄矮旅程；`text-search.test.ts` 保留空格、偏移、重叠和字面匹配逻辑 |
| search：查找不挤占表格、屏外虚拟长文案命中不裁剪、不被覆盖、编辑更新后失效、恢复匹配等待定位、不同面板词独立 | `search.spec.ts` 实测表格几何、elementFromPoint 和两标签；真实保存和外部 HTTP 修改 |
| table-controls、shell、layout、wide：表格余高、双层行、表头、固定详情、横向及纵向虚拟滚动、非模态详情不改变几何、键盘返回、页面不溢出 | `layout.spec.ts` 1600×1000、780×579、541×579、420×800、420×360；真实服务footer在窄矮视口换行，表格至少240px，其他视口保持80%以上高度 |
| 长文案原文、摘要、编辑内滚动、无长度限制、Tab保存、Enter重开 | `layout.spec.ts` 长文案；IME、Shift+Enter、保存租约、迟到返回、失败和断线由 #193 `editing.spec.ts`、`project-editing.test.ts` 承接，不重复字符串时钟 |
| segment-note-layout：空/长说明、原文可读、动态行高不覆盖邻行、Escape来源、外部刷新、删除关闭、三位序号 | `layout.spec.ts` 五视口说明旅程及600条真实数据；展开只读不申请修改权且不写项目 |
| visual-note：草稿关闭/失败、继续编辑、断线说明冲突、允许清空且不改文案 | #193 `segment-draft.spec.ts` 参数化文案/画面说明保存失败接续；本批 `layout.spec.ts` 实际重启、外部说明写入、冲突保留和清空 |
| speech-cell-layout：有效/待更新/运行/未生成/失败五种状态、完整文字、横向布局、主按钮数量和102px行高 | `layout.spec.ts` 780、541和420窄矮；仅这些UI状态在HTTP `/api/speech`边界注入，真实播放与制作交 #197 |
| row-hover：pen先于mouse、离开清除、手柄显示与选择叠加 | `layout.spec.ts` 2及7条真实项目；mouse使用高层API。Playwright没有pen高层API，仅pen设备输入用原生context的CDP session，不管理Chrome生命周期，不使用旧输入桥接 |
| dialog：Radix名称/说明、更多层卸载、Tab/ShiftTab约束、遮罩不关闭、窄矮关闭可达、亮色边框和键盘轮廓、动态禁用焦点后备 | `layout.spec.ts` 两视口设置查看和外部真实修改权动态占用；keyboard Escape产生focus-visible再测轮廓，鼠标点击不冒充键盘 |
| dialog：父子返回、来源失效、虚拟卸载/重排/删除和新意图优先 | #193 `focus.spec.ts`/`focus-module.spec.ts`；audio/video原生controls、素材取消、失败和迟到新模态由 #197 `speech.spec.ts`/`video.spec.ts` 承接 |
| layout：首次连接、读取失败、空项目区别，失败禁用修改 | `layout.spec.ts` 在真实状态HTTP边界暂停/503/恢复；不模拟React渲染或替换客户端 |
| panel-update-panel：兼容提示、编辑草稿、保存中、详情/更多/勾选未确认禁止刷新 | `panel-refresh.spec.ts` + `helpers/refresh-project.ts` 标准Vite页面与esbuild服务define；服务活动代次和页面加载代次明确分开，真实token/NDJSON/SQLite，不改写流；App活动上报idle→busy→idle以实际POST验证，只有该接口在HTTP边界返回受控200，绑定服务权限由panel-release/workspace测试承担 |
| panel-update-panel：播放/暂停/移除播放器、任务状态禁止刷新 | `panel-refresh.spec.ts` 实际WAV解码播放，媒体元素移除由MutationObserver接线观察；任务状态仅在HTTP响应边界受控注入 |
| panel-update-panel：同标签sessionStorage稳定勾选、过滤已删除ID、一次消费、断线清除、迟到恢复让位新勾选 | `panel-refresh.spec.ts` 实际页面重载、真实表格连接延迟、SQLite项目与服务查询核对；`panel-update.test.ts` 保留跨绑定/项目/实例/面板及损坏/过期/受限存储边界 |
| styles：生产同源CSS冲突门槛 | `style-collisions.test.ts` 改用Vitest和标准Vite生产构建，拥有临时目录并finally清理，保留真实产物注入历史grid冲突负例 |
| panel-targets旧通用等待/覆盖点助手 | 删除其专属测试；原生locator自动等待和真实命中替代旧工具协议。助手仍有其他批旧消费者，待最后消费者退出再删除 |

删除本批12个旧字符串浏览器文件、panel-targets专属测试及6个重复 `.native.ts` 对照。`panel-update.test.ts`、`text-search.test.ts` 和 `visual-note.test.ts` 仍为产品逻辑/SQLite保障。`panel-styles` 与 `panel-targets` 尚有其他批旧消费者，不在此批抢删。

受控构建身份只用于可重复验证刷新界面，未安装插件包、未更新实际宿主。原生失败附件通过命令 `--output` 指定本次独立目录；完整CI及最终性能对照由 #201 收口。
