# 统一组件维护

## 当前全站约定（#83 / #91）

页面及业务静态样式由所在 TSX 的 Tailwind 工具类拥有，通用控件从 `src/panel/components/ui/index.ts` 使用。已集中启用 Tailwind 4.3.3 Preflight，扫描范围仍为 `src/panel`；根主题覆盖页面和 body 下的 Dialog、Alert Dialog 与行菜单 Portal。保持亮色，表格强调色 `--color-accent` 与控件悬停色 `ui-accent` 分开。以下按工单编排的试点小节记录当时迁移过程，其中“不启用 Preflight”“保留旧 Dialog/CSS”仅为历史过渡状态，以本节现状为准。

`style.css` 仅保留主题映射与变量、根字体/亮色、页面高度及滚动约束、全局可见键盘轮廓和一项 AG Grid 适配。Preflight 提供通用盒模型、零边距及 hidden 行为；已删除重复 reset、全局 button/input/textarea/summary 规则、旧业务选择器和原生 `dialog.tsx` 通用适配。统一 Dialog 保留 Radix 最上层动态焦点后备，DetailPanel 保留业务嵌套返回，`dialog-focus.ts` 保留稳定片段身份恢复；不再维护原生 Dialog 的混合层兼容。

导出设置显式声明标题、说明、字段间距、问题列表与按钮布局；字号提交、自动保存及关闭校验仍由业务拥有。Button 的 outline 变体显式声明浅灰实线边框、亮色背景与前景，按钮光标也由组件拥有。任务 summary 在使用位置声明紧凑尺寸、悬停与按下样式，保留原生展开标记。标题、段落、列表与链接在各业务视图中明确表现；媒体布局与缩略图尺寸均由工具类维护，不依赖浏览器默认 margin 或旧控件规则。删除确认继续沿用本地 Alert Dialog 模板及可见主题契约。

### 必要例外与归属

- AG Grid 36.2.0 保留官方 `themeQuartz`、行高 80px、表头 40px、选择、编辑及虚拟滚动机制，项目主题配置使用共享语义变量。唯一无层 `.ag-cell[col-id="text"]` 用于维持文案垂直对齐：AG Grid 自带无层 display 会覆盖有层工具类，不能通过扩大样式冲突例外规避。
- 原生 audio/video 的内部播放控件由浏览器拥有；项目仍以工具类负责外框、宽高、布局及文字。NativeSelect 保留浏览器箭头、选项、size、长列表键盘与禁用行为，外部主题由统一组件拥有。
- 本次视频导入沿用“视频文件绝对路径”原生输入；当前没有 `type=file` 文件选择器，不新增文件选择系统，也不宣称已验证不存在的流程。
- 文案编辑器是 AG Grid 专用 textarea，保留 Enter 保存、Escape 取消、Shift+Enter 及 IME 交接；静态样式在 `text-editor.tsx`。缩略图与拖动手柄保留专用 button 尺寸、pointer capture 与触摸规则，不强制套普通 Button 的尺寸。
- 查找展开行高及 `text-search.tsx` 的 maxHeight、`segment-drag.tsx` 的 top/left/width 来自真实测量，保留动态 style；这些例外不豁免静态样式重写。

#91 未添加模板或依赖；本轮新增 Textarea 的官方来源、固定生成器版本、模板摘要、MIT 许可与本地适配见下方 #87 小节，既有 Button/Input/NativeSelect/Dialog/Alert Dialog/Context Menu 继续沿用记录的来源。依赖升级必须单独审查。测试的取消按钮契约补强浅灰边框色与实线，既有背景、文字、禁用和蓝色焦点要求不降低，样式冲突例外保持不变。

## 自动样式门槛

`npm run styles:check` 复用生产同源 Vite/Tailwind 编译，解析生成的 utilities 层与项目内既有 CSS 类名，发现同名冲突即失败。例外集中于 `scripts/style-collision-exceptions.json`，每项必须写完整 className 和经审查的 reason；重复、空理由或已不存在的冲突都会失败。优先消除冲突，例外不是忽略整类检查的开关。

`tests/helpers/theme-contract.ts` 集中维护 Button、行菜单和删除确认框的可见主题契约，包括背景、文字、边框、禁用透明度与键盘焦点轮廓；既有宽窄视口行菜单测试负责实际调用，保留表格布局、未迁移控件和行为回归。修改主题时同时审查矩阵预期，不能为了通过测试降低可见性要求。完整 `check` 和 CI 包含这些检查。

## 维护边界

遵循 ADR 0002，将删除确认中的按钮与口播片段行菜单接入项目内 `src/panel/components/ui/index.ts` 入口。业务继续拥有删除目标快照和修改权规则。

## 来源与版本

2026-10-07 依据 [shadcn/ui 现有 Vite 项目指南](https://ui.shadcn.com/docs/installation/vite) 定向添加 Vite 插件、样式入口、TypeScript/Vite 别名和 `components.json`；未重新生成项目。生成器按需使用固定版本命令 `npx shadcn@4.21.3 add <组件>`（不纳入运行时或常规构建依赖），添加前检查差异，不覆盖业务适配。

Button 源码来自 [官方 new-york-v4 registry](https://ui.shadcn.com/r/styles/new-york-v4/button.json)，采用 Radix 路线（`radix-ui` 1.7.0）。后续试点菜单和确认弹窗沿用同一路线。模板属于本地源码，升级时对照上游审阅，保留本地主题、可访问语义与业务集成；不以重新生成替代审查。

Tailwind CSS 与 Vite 插件锁定 4.3.3，插件 peer 支持 Vite `^5.2.0 || ^6 || ^7 || ^8`，匹配本项目 8.3.1。Radix peer 支持 React/React DOM 19，匹配项目 19.3.0；TypeScript 7.0.2 的兼容性由类型检查验证。其余辅助依赖锁定 `class-variance-authority` 0.7.1、`clsx` 2.1.1、`tailwind-merge` 3.7.0；锁文件保留完整传递版本。

## 样式与入口

`@/*` 指向 `src/panel/*`。业务从统一 UI 入口导入，组件内部从 `@/lib/utils.js` 使用类名合并工具。模板仅定向适配工具入口与 `bg-ui-accent`：现有 `--color-accent` 已用于 AG Grid，不能覆盖为 shadcn 的悬停背景。

Tailwind 使用[官方可分离的 theme/utilities 样式入口](https://tailwindcss.com/docs/preflight#disabling-preflight)，不启用全局 Preflight，防止试点重置未迁移控件的浏览器基础样式。工具类扫描显式覆盖 `src/panel`，业务布局直接使用 Tailwind，通用控件经统一 UI 入口使用；原表格容器 `.grid` 已更名为 `.segment-grid` 并移除同名旧规则，避免与标准工具类冲突。扩大到面板之外之前，先核对命名冲突。仅通用 button 基础规则放在 components 层，让 utilities 层为试点 Button 提供样式；其余既有 CSS 保持无层优先级，保留 AG Grid 文案单元格等局部覆盖；AG Grid Quartz 及原有语义变量保持原值。`background/foreground` 对应现有 surface/ink，primary/ring 对应 focus，destructive 对应 error，ui-accent 对应 hover，圆角对应 radius-control。

独立浏览器集成测试仍由 esbuild 打包页面，随后通过与生产相同的 Vite/Tailwind 插件编译同一 `style.css` 为 `test.css`，覆盖 esbuild 未转换的 CSS。测试从可见颜色、边框、点击高度与完整交互核对结果，不检查工具类组合。

## 行菜单（#76）

Context Menu 源码按需取自 [官方 new-york-v4 registry](https://ui.shadcn.com/r/styles/new-york-v4/context-menu.json)（2026-10-07，模板 SHA256 `e9680a7b71840b7203e1625acab8754d7c18122b66289baf281c3a6e31246ada`）。沿用 `radix-ui` 1.7.0，锁文件中的 `@radix-ui/react-context-menu` 为 2.3.8、`@radix-ui/react-menu` 为 2.1.25。仅保留 Root、Trigger、Content、Item，未引入不使用的图标与子菜单；适配 cn 入口、ui-accent、明确实线及 `--color-border` 浅灰边框、最小点击高度、视口最大宽度，并映射 popover 主题。无新增依赖。

非模态常驻 Root 和 asChild Trigger 复用原语的真实右键定位、导航、激活及 Escape；鼠标打开先聚焦菜单容器，方向键进入选项。业务校验真实行身份、勾选范围与锁，仅为当前项动态禁用增加焦点落到首个可用项或容器的适配。关闭时按原因恢复稳定片段焦点，非模态外部点击继续激活原目标并保留其焦点，删除和插入将焦点交给现有 Dialog 或文案编辑器。删除弹窗此阶段仍用原生 Dialog。触摸长按不会绕过真实 contextmenu 行身份校验打开旧目标。

浏览器证据覆盖实际主题颜色、三项操作、方向键/Home/End/Enter/Space/Escape、四类动态锁、宽窄及窄高右下边缘、查找勾选与滚动保留、菜单到原生删除确认的焦点交接。完整页面和真实 AG Grid 保持不变，替身只位于 HTTP 客户端边界。

## 删除确认与焦点恢复（#77）

Alert Dialog 源码取自 [官方 new-york-v4 registry](https://ui.shadcn.com/r/styles/new-york-v4/alert-dialog.json)（2026-10-07，模板 SHA256 `03c0d4de131a9b049e9080724666045c8785074af7e07040a0a0f922a810e7c2`），沿用 `radix-ui` 1.7.0 与锁文件中的 `@radix-ui/react-alert-dialog` 1.1.24。保留上游 MIT 许可，省略未使用的 Trigger、Media，适配 cn/Button 入口。Content 加入视口最大高度及纵向滚动、显式实线及 `--color-border` 浅灰边框与主题前景；将默认布局改为 flex，避免模板生成的全局 `.grid` 工具类影响既有同名表格容器。没有调整 legacy CSS 层级，没有增加依赖。

删除目标仍由 App 在打开确认时深拷贝完整 expected 快照。Radix 提供 alertdialog、Title/Description、默认取消焦点、Tab 环绕与 Escape；`DeleteConfirm` 仅为确认按钮动态禁用时补充取消焦点。确认仍通过既有编辑协调器重新申请修改权；结果落地后关闭弹窗，稳定片段身份优先，删除后使用相邻显示行或“更多”后备。虚拟行的滚动定位同步刷新 React DOM，再聚焦新单元格，避免依赖旧节点。轮询重排和删除反馈仍按服务原有规则处理。

等待已确认请求时仍可取消或 Escape 关闭确认；这不撤回已发出的请求。若用户已转去查找，迟到响应不会重新打开确认或抢焦点。失败及结果未知均不自动重试。原有 Dialog 及非试点按钮继续服务设置、素材、配音等浮层；其嵌套与键盘测试保留。

完整试点体积、方法与推广边界见 [试点评估](ui-pilot-evaluation.md)。本节描述源码行为，不能作为本机安装或实际宿主交付成功证明。

## 导出设置表单（#80）

导出设置的字号、操作按钮及三个原生选择器通过统一 UI 入口使用 Input、Button、NativeSelect；业务继续拥有草稿、修改权、自动保存与关闭校验。表单与弹窗切片分别实现，集成后由统一 Dialog 承载；选择器保留浏览器箭头、原生选项、`size`、禁用和键盘交互，不引入 Radix Select 或图标依赖。

Input 和 NativeSelect 分别按 [官方 Input 模板](https://ui.shadcn.com/r/styles/new-york-v4/input.json) 与 [官方 Native Select 模板](https://ui.shadcn.com/r/styles/new-york-v4/native-select.json) 适配（2026-10-07；原始 JSON SHA256 分别为 `b1fffa12ba72ce30a291749012b47235eda110648b8106725ced22b5b31c8f1b`、`950729a758bef332865adc55f25c16667f45347ef850ee7be20b741667f55d8b`）。文件保留上游 MIT 许可；升级时对照模板审阅，保留本地 cn 入口、亮色表面与文字、实线边框和可见焦点。NativeSelect 省略包装层、自绘箭头与未使用的 Option/OptGroup 组件，直接透传原生 select 属性。Input 保留上游输入类型和属性透传；两者不管理任何业务状态。

Tailwind 扫描范围与 Preflight 策略不变，没有新增全局 CSS 规则。既有弹窗字段布局规则继续负责宽度与间距，组件负责主题与禁用态。`tests/helpers/theme-contract.ts` 的 `form` 契约覆盖正常主题，键盘焦点另检蓝色轮廓。`tests/export-settings-panel.test.ts` 使用完整页面、真实 AG Grid、HTTP 客户端边界替身及生产同源样式，核对查看与编辑、任务锁及占用、加载与字体不可用、自动保存与字号边界、错误及断线，并在 1600×1000、420×800、420×360 视口验证控件可达性与主题；浏览器缺失明确失败。既有编辑、表格及弹窗测试继续执行。

## 导出设置弹窗（#81）

Dialog 源码按需参考 [官方 new-york-v4 registry](https://ui.shadcn.com/r/styles/new-york-v4/dialog.json)（2026-10-07，模板 SHA256 `0115e3a57aa55a978c5fed0d77f7e98edd694215aae3e569def3fff722ba9f26`）。保留 MIT 许可，沿用现有 radix-ui，无新增依赖。统一入口仅导出使用中的 Root、Content、Title 和 Description；省略 Trigger、右上角 Close、图标及未使用布局。采用 flex 避免与既有 .grid 类名冲突，显式浅灰实线边框及亮色前景背景，保留视口最大宽高和内部滚动。

Content 初始聚焦容器，动态禁用当前控件时也以容器作为后备；Radix 提供模态背景隔离和 Tab 约束。明确 aria-modal，使原生 Dialog 的延迟恢复通过公共模态语义识别新弹窗，避免“更多”卸载后抢走焦点。原生浮层仍按原有嵌套路径恢复。遮罩点击被阻止；受控 Root 的关闭请求交给 ExportSettingsPanel 原有校验，保存、未提交字号及修改权释放规则仍在业务模块。关闭自动焦点由业务恢复至页头“更多”。

dialog-panel 使用完整主视图、真实 AG Grid 与 HTTP 边界替身，覆盖标题说明、异步焦点交接、键盘环绕、遮罩隔离、保存中全部禁用、未提交字号、释放与焦点恢复；另覆盖 360×320 窄矮视口的滚动可达性与生产同源主题。layout-panel 以可见可访问语义兼容新旧弹窗，声音、素材及原生嵌套流程保留。这些源码测试不能代替本机插件安装和实际宿主验收。

## 页面壳、页头、查找和状态栏（#84）

页面壳与表格剩余高度、页头、查找、文案摘要和高亮、状态及错误区域的静态样式由所在 TSX 的 Tailwind 工具类拥有，原有对应规则已移除。查找展开行高及命中滚动仍使用原运行时测量；`.segment-grid`、`.search-popover`、`.text-summary`、`.text-search-current` 保留为稳定定位标识，不再拥有 CSS 规则。

页头、查找定位和状态操作使用既有 Button，查找使用 Input；页头保持 32px，查找及状态操作使用紧凑尺寸。未引入新依赖或启用 Preflight。input/textarea 的原基础规则放入 components 层，使 Input 的工具类可生效；未迁移表单及文案编辑器保留局部布局覆盖。表格强调色仍为 `--color-accent`，控件悬停继续使用 `ui-accent`，冲突例外未扩大。

完整页面测试增加 1600×1000、420×800、420×360 的操作可达性、主题、键盘焦点、任务锁及错误可见性，浏览器缺失明确失败；原查找全流程继续覆盖匹配循环、勾选、长文案展开、滚动、编辑和重新打开。迁移前生产产物、锁定依赖及宽窄/窄矮视觉证据由 #83 运行记录的 baseline 目录持久保存，用于收尾在同环境比较。源码测试不代表实际宿主交付。

## 更多、任务记录与连接诊断（#85）

三个入口复用统一 Dialog、Title 和 Button；业务包装 `DetailPanel` 仅组合标题、可选说明、静态布局与关闭时的焦点交接，关闭决定仍由调用者拥有。新旧模态层切换时优先保留已打开层内的焦点，最终关闭沿用业务稳定入口恢复；用户已转向仍可用的外部元素时不抢焦点。声音、粘贴和媒体旧弹窗在其迁移工单落地前保留。

对应的更多布局、诊断定义列表、导出任务、错误与警告列表及成片链接由 TSX 的 Tailwind 工具类拥有，删除对应旧 CSS 选择器。显式保留标题层级、列表项目符号与缩进、链接下划线和主题色；任务取消条件及 HTTP 请求不变。未引入依赖、模板或全局重置。

`more-tasks-panel` 在 1600×1000、420×800、420×360 完整主视图中覆盖新旧切换、任务取消中禁用、焦点后备、Tab/Shift+Tab、Escape、遮罩、主题、列表与成片链接、长诊断及导出设置返回；浏览器缺失明确失败。已有导出、布局、弹窗和勾选流程保留语义断言。受控浏览器证据仅证明源码行为，不代表本机安装或实际宿主交付。

## 粘贴多行文案（#87）

粘贴面板通过统一入口使用 Textarea、Button，并复用 DetailPanel 的 Dialog 与标题。草稿、按非空行提交、修改权申请及释放继续由主视图和编辑协调器管理；获取修改权及提交期间禁止关闭，失败保留草稿与面板内错误。布局与错误样式采用 Tailwind；全局 textarea 布局已移除，文案编辑器需要的宽度与显示规则由专用工具类拥有，不再覆盖统一组件。

Textarea 取自 [官方 new-york-v4 registry](https://ui.shadcn.com/r/styles/new-york-v4/textarea.json)（2026-10-08，模板 JSON SHA256 `2367d3964326b19ca2355f872d08153c86932abd4b103b5fd02039a3f2cb8ae5`；生成器基线固定 `shadcn@4.21.3`）。保留上游 MIT 许可，适配本地 cn 入口、亮色前景背景、明确实线边框和既有 100px 最小高度；保留原生垂直调整大小与内部滚动，不采用随内容无限扩张的 field-sizing。没有新增依赖。

`paste-panel` 在 1600×1000、420×800、420×360 的完整页面中验证真实键盘多行输入、真实 AG Grid 结果、任务锁和外部占用、修改权申请失败、提交成功与失败、忙时关闭限制、释放、Tab/Shift+Tab、Escape、遮罩和滚动可达性。测试使用生产同源样式，仅替换 HTTP 客户端，浏览器缺失明确失败。源码证据不代表本机安装或实际宿主交付完成。

## 声音设置（#86）

声音设置复用 DetailPanel 和统一 NativeSelect、Button；两个选择器仍为浏览器原生控件，保留全部音色与 -50 至 100 的 151 个语速选项。业务表单间距、说明、错误与布局由 VoicePanel 内 Tailwind 工具类拥有，不再使用旧 toolbar/media-dialog 规则。这些共享旧规则仍服务其他未迁移区域，收尾统一清理；没有新增模板、依赖或基础样式。

立即保存继续通过既有 setVoice 与 editing.run 执行，声音修改原本不持有客户端 beginEdit 租约；服务端沿用单次声音变更的访问校验。任务锁、他人占用、页面编辑占用和提交互斥保持不变。保存期间禁用全部表单及关闭按钮，Escape 由业务状态拦截，统一弹窗容器承接被禁用控件的焦点；保存失败保留可访问错误，成功或取消查看后返回“更多”。

完整页面 voice-panel 浏览器验证加载、原生选项与真实方向键、成功/失败、四类锁、模态 Tab/Shift+Tab、遮罩、提交禁关、关闭恢复及亮色主题，在 1600×1000、420×800、420×360 下验证长配置路径滚动可达性。测试仅替换 HTTP 客户端边界；源码证据不代表本机安装或实际宿主验收。

## 表格内操作与专用交互（#90）

画面素材详情、配音生成、试听与保留音频入口统一使用 Button 的 24px 紧凑尺寸，显式保留 12px 文字、实线边框及键盘焦点轮廓。缩略图维持 52×32px，拖动手柄继续使用原生按钮和指针捕获路径；这些专用控件、文案编辑器、配音状态及操作布局的静态样式由对应 TSX 的 Tailwind 工具类拥有，没有新增依赖或模板。

AG Grid Quartz 参数继续映射共享颜色、字体、间距及圆角，固定行高 80px、表头 40px 和查找展开测量不变。仅保留 `.ag-cell[col-id="text"]` 的垂直居中第三方适配：AG Grid 注入的无层单元格 display 规则优先于 utilities 层，直接使用 cellClass 工具类会使正文失去弹性居中；真实行菜单浏览器测试的计算样式断言捕获了该回归，恢复适配后通过。该规则不承担正文或控件的业务静态表现。查找结果高度、命中滚动和拖动指示线位置仍由运行时测量提供。

`table-controls-panel` 在宽、窄和窄矮视口检查真实虚拟行、行高、紧凑按钮主题、任务锁禁用及可见键盘焦点；既有编辑、查找、勾选、拖动、菜单和删除回归继续使用完整主视图。全局 textarea 布局已删除，专用编辑器工具类明确拥有显示、宽高、间距与调整大小规则；剩余 input/textarea 基础规则仍在 components 层，由 #91 统一清理。源码验证不代表本机安装或实际宿主交付。

## 宽面板与联动详情（#94）

文案分配剩余列宽；素材列 110px、配音列 118px、行尾详情 44px，保留 AG Grid 的固定 80px 行高、虚拟化和稳定身份。未承载业务数据的画面说明占位列移除。缩略图仅提供视频预览；文件名、时长、起点及关联入口在详情中保留。新增入口采用主题主色，查找改为绝对定位浮层；底部加号与顶部新增共用服务创建、清除筛选、稳定身份定位与详情文案聚焦。

文案单击进入 AG Grid 行内 textarea，保留完整内容、失焦提交、键盘和 IME 规则，移除弹出编辑器与快捷键说明。详情采用非模态 aside，宽度最多 450px，不调整表格几何；300ms 位移动画在减少动态效果时关闭。详情编辑继续申请现有编辑租约；脏草稿在关闭、导航和行内交接前经过统一确认。失败保留草稿和意图，断线重存重新取得修改权并核对基准文案，拒绝覆盖其他操作的新文案。

SegmentSpeech 仅呈现服务已有任务和输入快照结果；单元格提供生成、试听／暂停与保留音频图标。详情按需呈现原生播放器，未保存或空文案禁止生成。页面监听原生媒体 play 事件暂停其他播放器，历史音频与视频预览沿用统一 Dialog；不引入浏览器朗读或第二套生成逻辑。

新增宽面板、草稿与实际视频播放浏览器测试，继续复用生产同源 Tailwind 编译及 HTTP 客户端替身。媒体测试服务器只提供实际 MP4 静态资源与 Range，不替换媒体控件。测试覆盖 1200×800、780×579、420×800、420×360，另保留原有窄矮视口、主题、行菜单和业务回归。源码测试不代表实际宿主验收。

设计质量辅助参考 [Impeccable 官方仓库](https://github.com/pbakaus/impeccable/tree/d631a8827f99414d2b6daba4ef08b7f8701751d7) 的 Apache-2.0 许可、README 接入说明与 audit 检查维度。本次实际采用可访问名称、键盘焦点、减少动态效果、主题令牌、视口溢出及无多余依赖的人工检查清单，并以浏览器测试核对；没有安装其全局技能、引擎或钩子，也未将其自动检测器结果当作证据。官方安装器会安装提供者钩子，项目本轮不需要；现有 shadcn/Radix 与 Tailwind 继续拥有运行时 UI。
