# 统一组件维护

## 全站约定（#83 / #91）

页面及业务静态样式由所在 TSX 的 Tailwind 工具类拥有，通用控件从 `src/panel/components/ui/index.ts` 使用。已集中启用 Tailwind 4.3.3 Preflight，扫描范围为 `src/panel`；根主题覆盖页面和 body 下的 Dialog、Alert Dialog 与行菜单 Portal。保持亮色，表格强调色 `--color-accent` 与控件悬停色 `ui-accent` 分开。

`style.css` 仅保留主题映射与变量、根字体/亮色、页面高度及滚动约束、全局可见键盘轮廓和限定的 AG Grid 适配。Preflight 提供通用盒模型、零边距及 hidden 行为；不新增全局 button/input/textarea/summary 规则或业务选择器。统一 Dialog 保留 Radix 最上层动态焦点后备，DetailPanel 保留业务嵌套返回，`dialog-focus.ts` 保留稳定片段身份恢复。

导出设置显式声明标题、说明、字段间距、问题列表与按钮布局；字号提交、自动保存及关闭校验由业务拥有。Button 的 outline 变体显式声明浅灰实线边框、亮色背景与前景，按钮光标也由组件拥有。任务 summary 在使用位置声明紧凑尺寸、悬停与按下样式，保留原生展开标记。标题、段落、列表与链接在各业务视图中明确表现；媒体布局与缩略图尺寸均由工具类维护，不依赖浏览器默认 margin。

### 必要例外与归属

- AG Grid 36.2.0 保留官方 `themeQuartz`、选择、编辑及虚拟滚动机制，项目主题配置使用共享语义变量。唯一无层 `.ag-cell[col-id="text"]` 用于维持文案垂直对齐：AG Grid 自带无层 display 会覆盖有层工具类，不能通过扩大样式冲突例外规避。
- 原生 audio/video 的内部播放控件由浏览器拥有；项目以工具类负责外框、宽高、布局及文字。NativeSelect 保留浏览器箭头、选项、size、长列表键盘与禁用行为，外部主题由统一组件拥有。
- 视频导入使用“视频文件绝对路径”原生输入；当前没有 `type=file` 文件选择器，不新增文件选择系统。
- 文案编辑器是 AG Grid 专用 textarea，保留 Enter 保存、Escape 取消、Shift+Enter 及 IME 交接；静态样式在 `text-editor.tsx`。缩略图与拖动手柄保留专用 button 尺寸、pointer capture 与触摸规则，不强制套普通 Button 的尺寸。
- 查找展开行高及 `text-search.tsx` 的 maxHeight、`segment-drag.tsx` 的 top/left/width 来自真实测量，保留动态 style；这些例外不豁免静态样式重写。

## 自动样式门槛

`npm exec vitest -- run tests/style-collisions.test.ts` 复用生产同源 Vite/Tailwind 编译，解析生成的 utilities 层与项目内既有 CSS 类名，发现同名冲突即失败。例外集中于 `scripts/style-collision-exceptions.json`，每项必须写完整 className 和经审查的 reason；重复、空理由或已不存在的冲突都会失败。优先消除冲突，例外不是忽略整类检查的开关。

`tests/helpers/theme-contract.ts` 集中维护 Button、行菜单、删除确认框和表单的可见主题契约，包括背景、文字、边框、禁用透明度与键盘焦点轮廓；浏览器测试负责实际调用。修改主题时同时审查矩阵预期，不能为了通过测试降低可见性要求。完整 `check` 和 CI 包含这些检查。

## 维护边界

遵循 ADR 0002，通用控件经项目内 `src/panel/components/ui/index.ts` 入口接入。业务继续拥有删除目标快照、草稿和修改权规则。

## 来源与版本

依据 [shadcn/ui 现有 Vite 项目指南](https://ui.shadcn.com/docs/installation/vite) 定向添加 Vite 插件、样式入口、TypeScript/Vite 别名和 `components.json`。生成器按需使用固定版本命令 `npx shadcn@4.21.3 add <组件>`（不纳入运行时或常规构建依赖），添加前检查差异，不覆盖业务适配。依赖升级必须单独审查。

模板属于本地源码，统一采用 Radix 路线（`radix-ui` 1.7.0），保留上游 MIT 许可；升级时对照上游审阅，保留本地 cn 入口、亮色主题、浅灰实线边框、可见焦点、可访问语义与业务集成，不以重新生成替代审查。各模板来自官方 new-york-v4 registry：

| 组件 | 来源与摘要 | 本地适配 |
| --- | --- | --- |
| Button | [button.json](https://ui.shadcn.com/r/styles/new-york-v4/button.json) | 紧凑尺寸供页头、查找、状态及表格内操作使用 |
| Context Menu | [context-menu.json](https://ui.shadcn.com/r/styles/new-york-v4/context-menu.json)，SHA256 `e9680a7b71840b7203e1625acab8754d7c18122b66289baf281c3a6e31246ada`；`@radix-ui/react-context-menu` 2.3.8、`@radix-ui/react-menu` 2.1.25 | 仅 Root、Trigger、Content、Item；最小点击高度、视口最大宽度、popover 主题 |
| Alert Dialog | [alert-dialog.json](https://ui.shadcn.com/r/styles/new-york-v4/alert-dialog.json)，SHA256 `03c0d4de131a9b049e9080724666045c8785074af7e07040a0a0f922a810e7c2`；`@radix-ui/react-alert-dialog` 1.1.24 | 省略 Trigger、Media；视口最大高度及纵向滚动；flex 布局避免 `.grid` 工具类影响表格容器 |
| Input | [input.json](https://ui.shadcn.com/r/styles/new-york-v4/input.json)，SHA256 `b1fffa12ba72ce30a291749012b47235eda110648b8106725ced22b5b31c8f1b` | 保留输入类型和属性透传，不管理业务状态 |
| NativeSelect | [native-select.json](https://ui.shadcn.com/r/styles/new-york-v4/native-select.json)，SHA256 `950729a758bef332865adc55f25c16667f45347ef850ee7be20b741667f55d8b` | 省略包装层、自绘箭头与 Option/OptGroup，直接透传原生 select 属性 |
| Dialog | [dialog.json](https://ui.shadcn.com/r/styles/new-york-v4/dialog.json)，SHA256 `0115e3a57aa55a978c5fed0d77f7e98edd694215aae3e569def3fff722ba9f26` | 仅 Root、Content、Title、Description；省略 Trigger、右上角 Close 与图标；flex 布局，视口最大宽高和内部滚动 |
| Textarea | [textarea.json](https://ui.shadcn.com/r/styles/new-york-v4/textarea.json)，SHA256 `2367d3964326b19ca2355f872d08153c86932abd4b103b5fd02039a3f2cb8ae5` | 100px 最小高度，保留原生垂直调整与内部滚动，不采用 field-sizing |
| Dropdown Menu | [dropdown-menu.json](https://ui.shadcn.com/r/styles/new-york-v4/dropdown-menu.json)；Dropdown Menu 原语 2.1.25 | 手工保留 Root、Trigger、Content、Item；视口碰撞避让，32px 菜单项高度 |

图标采用 [Radix Icons](https://www.radix-ui.com/icons) 1.3.2，不以文字符号模拟。Tailwind CSS 与 Vite 插件锁定 4.3.3；其余辅助依赖锁定 `class-variance-authority` 0.7.1、`clsx` 2.1.1、`tailwind-merge` 3.7.0，锁文件保留完整传递版本。

设计质量检查参考 [Impeccable 官方仓库](https://github.com/pbakaus/impeccable/tree/d631a8827f99414d2b6daba4ef08b7f8701751d7)（Apache-2.0）的 audit 维度：可访问名称、键盘焦点、减少动态效果、主题令牌、视口溢出及无多余依赖，以浏览器测试核对；不安装其全局技能、引擎或钩子，也不将其自动检测器结果当作证据。

## 样式与入口

`@/*` 指向 `src/panel/*`。业务从统一 UI 入口导入，组件内部从 `@/lib/utils.js` 使用类名合并工具。`--color-accent` 已用于 AG Grid，不能覆盖为 shadcn 的悬停背景，模板悬停使用 `bg-ui-accent`。主题映射：`background/foreground` 对应 surface/ink，primary/ring 对应 focus，destructive 对应 error，ui-accent 对应 hover，圆角对应 radius-control。表格容器使用 `.segment-grid`，避免与标准 `.grid` 工具类冲突；扩大工具类扫描范围前先核对命名冲突。

浏览器测试使用生产同源 Vite/Tailwind 样式，从可见颜色、边框、点击高度与完整交互核对结果，不检查工具类组合；替身仅位于 HTTP 客户端边界。

## 组件行为

### 行菜单（#76）

非模态常驻 Root 和 asChild Trigger 复用原语的真实右键定位、导航、激活及 Escape；鼠标打开先聚焦菜单容器，方向键进入选项。业务校验真实行身份、勾选范围与锁，当前项动态禁用时焦点落到首个可用项或容器。关闭时按原因恢复稳定片段焦点，非模态外部点击继续激活原目标并保留其焦点，删除和插入将焦点交给 Alert Dialog 或文案编辑器。触摸长按不会绕过真实 contextmenu 行身份校验打开旧目标。

### 删除确认与焦点恢复（#77）

删除目标由 App 在打开确认时深拷贝完整 expected 快照。Radix 提供 alertdialog、Title/Description、默认取消焦点、Tab 环绕与 Escape；`DeleteConfirm` 仅为确认按钮动态禁用时补充取消焦点。确认通过既有编辑协调器重新申请修改权；结果落地后关闭弹窗，稳定片段身份优先，删除后使用相邻显示行或“更多”后备。虚拟行的滚动定位同步刷新 React DOM，再聚焦新单元格。

等待已确认请求时仍可取消或 Escape 关闭确认；这不撤回已发出的请求。若用户已转去查找，迟到响应不会重新打开确认或抢焦点。失败及结果未知均不自动重试。

### 导出设置（#80 / #81）

字号、操作按钮及三个原生选择器通过统一入口使用 Input、Button、NativeSelect，由统一 Dialog 承载；业务拥有草稿、修改权、自动保存与关闭校验。选择器不引入 Radix Select 或图标依赖。

Content 初始聚焦容器，动态禁用当前控件时也以容器作为后备；Radix 提供模态背景隔离和 Tab 约束，并明确 aria-modal。遮罩点击被阻止；受控 Root 的关闭请求交给 ExportSettingsPanel 校验，保存、未提交字号及修改权释放规则在业务模块。关闭后焦点由业务恢复至页头“更多”。

### 页面壳、页头、查找和状态栏（#84）

页面壳与表格剩余高度、页头、查找、文案摘要和高亮、状态及错误区域的静态样式由所在 TSX 的工具类拥有。查找展开行高及命中滚动使用运行时测量；`.segment-grid`、`.search-popover`、`.text-summary`、`.text-search-current` 只作稳定定位标识，不拥有 CSS 规则。页头、查找定位和状态操作使用 Button，查找使用 Input；页头保持 32px，查找及状态操作使用紧凑尺寸。

### 更多、任务记录与连接诊断（#85）

三个入口复用统一 Dialog、Title 和 Button；业务包装 `DetailPanel` 仅组合标题、可选说明、静态布局与关闭时的焦点交接，关闭决定由调用者拥有。模态层切换时优先保留已打开层内的焦点，最终关闭沿用业务稳定入口恢复；用户已转向仍可用的外部元素时不抢焦点。布局、诊断定义列表、导出任务、错误与警告列表及成片链接显式保留标题层级、列表项目符号与缩进、链接下划线和主题色。

### 粘贴多行文案（#87）

粘贴面板使用 Textarea、Button，并复用 DetailPanel。草稿、按非空行提交、修改权申请及释放由主视图和编辑协调器管理；获取修改权及提交期间禁止关闭，失败保留草稿与面板内错误。

### 声音设置（#86）

声音设置复用 DetailPanel、NativeSelect 和 Button；两个选择器为浏览器原生控件，保留全部音色与 -50 至 100 的 151 个语速选项。立即保存通过既有 setVoice 与 editing.run 执行，声音修改不持有客户端 beginEdit 租约；服务端沿用单次声音变更的访问校验。保存期间禁用全部表单及关闭按钮，Escape 由业务状态拦截，统一弹窗容器承接被禁用控件的焦点；保存失败保留可访问错误，成功或取消查看后返回“更多”。

### 表格内操作（#90）

素材详情、配音生成、试听与保留音频入口使用 Button 的 24px 紧凑尺寸，显式保留 12px 文字、实线边框及键盘焦点轮廓。缩略图与拖动手柄沿用原生按钮和指针捕获路径；专用控件、文案编辑器、配音状态及操作布局的静态样式由对应 TSX 的工具类拥有。

## 片段行布局

表头为“序号”和“口播片段”，表头 38px、折叠行高 102px。文案横跨上层，使用 15px 字号；下层高 54px、元素间距 16px，依次呈现缩略图（84×44px 框内保持原图比例）、画面说明一行摘要、试听／生成主按钮和配音状态，说明与状态为 12px。浅蓝表面与细分层线区分上下层，仅在行底保留 4px 留白。搜索展开至少保留 102px 行高。

序号列起始 64px，随项目序号位数扩宽；勾选列 34px；文案区域最小 360px 并分配剩余空间；行尾 48px 操作列固定在右侧，上层放说明展开箭头和悬浮／键盘可见的详情入口，下层放配音更多菜单。窄面板在表格内部横向滚动，行尾入口保持可见。序号、勾选、行尾操作由 AG Grid 管理，并保留 AG Grid 的选择、拖动、编辑与虚拟化。

`SegmentRowCell` 组合文案与辅助内容，`SegmentRowActions` 拥有行尾操作，`SegmentSpeechMenu` 复用配音提交、禁用和历史交接逻辑，`SegmentSpeech` 提供行内试听与详情两种呈现。文案单元格由 AG Grid 承接编辑，点击下层普通状态文字只选择片段，不进入文案编辑。行尾操作采用固定 renderer 身份，避免抽屉关闭与数据刷新时卸载焦点按钮；详情返回优先识别 `data-row-details`。

### 画面说明展开

画面说明摘要只做视觉截断，摘要和行尾箭头均可展开完整原文；展开区带浅蓝背景，长原文在区内滚动。同一时刻只展开一个稳定身份的片段。展开区经 React Portal 挂到真实虚拟行，ResizeObserver 把实测高度交回 AG Grid；宽度和横向位移来自表格视口测量。关闭行位移动画，避免说明增高时覆盖相邻行。刷新保留当前展开身份，删除该片段后关闭展开区；Escape 或收起按钮返回对应箭头。

画面说明的数据规则：SQLite 打开旧项目时补齐非空说明列，默认空字符串；新增、相对插入及粘贴也默认空说明。MCP 查询返回 visualNote；新增可指定说明，edit 可修改文案、说明或两者，省略字段保持原值，空字符串清空。修改、删除和关联素材的完整 expected 核对包含说明。说明只供用户与 Codex 参考，不参与配音有效性或导出渲染；查找只处理文案。

### 配音主按钮与更多操作

有保留音频时主按钮直接试听／暂停；无音频时生成或重试，排队与生成中禁用提交。已有音频与最新失败、未知或运行任务并存时，同时显示音频有效性和任务状态；任务锁阻止生成但允许试听已有音频。重新生成／重试和保留音频与任务记录收入更多菜单，使用现有制作请求与历史弹窗。更多菜单为非模态，提供方向键和 Escape；打开保留音频时阻止菜单抢回焦点，弹窗关闭恢复稳定片段。不提供时长、波形或播放进度。

### 片段详情

详情采用非模态 aside，宽度最多 450px，不调整表格几何；300ms 位移动画在减少动态效果时关闭。详情用 Textarea 编辑文案与画面说明，两者共用草稿和编辑租约；关闭、切换片段或进入行内编辑时统一确认未保存内容。失败保留草稿和意图，断线重存重新取得修改权并核对基准文案和说明，拒绝覆盖其他操作的新内容。配音与导出任务期间阻止普通修改。

详情按需呈现原生播放器，未保存或空文案禁止生成。页面监听原生媒体 play 事件暂停其他播放器，历史音频与视频预览使用统一 Dialog；不引入浏览器朗读或第二套生成逻辑。新增入口采用主题主色，查找为绝对定位浮层；底部加号与顶部新增共用服务创建、清除筛选、稳定身份定位与详情文案聚焦。

## 行悬浮输入兼容

实际宿主可能先发送 `pointerType=pen` 的悬浮事件，再发送 `mouse`；AG Grid 36.2.0 的行悬浮监听仅处理 `mouse`，会导致高亮延迟。表格设置 `suppressRowHoverHighlight`，视觉高亮由原生 `:hover` 驱动，拖动手柄同步使用相同状态，不增加 React 悬浮状态或计时器。

`style.css` 中限定于 `.segment-grid` 的 AG Grid 适配复用 Quartz 滚动列／固定列的覆盖层和主题颜色，保留悬浮与勾选背景的叠加。依赖升级时须复核这些第三方覆盖层选择器。浏览器测试须分别发送 `pen` 和 `mouse` 指针移动，避免仅用鼠标输入漏测实际宿主的事件类型。

## 面板资源更新入口

兼容的面板资源代次变化后，状态栏提供“刷新面板”，使用既有 Button。编辑、保存、详情、菜单、播放、任务或勾选连接未确认时禁止刷新；活动报告失效由服务保守阻止切换。刷新只恢复同标签页显式保存的稳定片段勾选，保留范围隔离；不能用跨标签共享选择或刷新后的空选代替用户原范围。运行时及实际面板身份分别在连接诊断中核对，避免把兼容的旧进程误标为失效。
