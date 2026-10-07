# 试点组件维护

遵循 ADR 0002，将删除确认中的按钮与口播片段行菜单接入项目内 `src/panel/components/ui/index.ts` 入口。业务继续拥有删除目标快照和修改权规则。

## 来源与版本

2026-10-07 依据 [shadcn/ui 现有 Vite 项目指南](https://ui.shadcn.com/docs/installation/vite) 定向添加 Vite 插件、样式入口、TypeScript/Vite 别名和 `components.json`；未重新生成项目。生成器按需使用固定版本命令 `npx shadcn@4.21.3 add <组件>`（不纳入运行时或常规构建依赖），添加前检查差异，不覆盖业务适配。

Button 源码来自 [官方 new-york-v4 registry](https://ui.shadcn.com/r/styles/new-york-v4/button.json)，采用 Radix 路线（`radix-ui` 1.7.0）。后续试点菜单和确认弹窗沿用同一路线。模板属于本地源码，升级时对照上游审阅，保留本地主题、可访问语义与业务集成；不以重新生成替代审查。

Tailwind CSS 与 Vite 插件锁定 4.3.3，插件 peer 支持 Vite `^5.2.0 || ^6 || ^7 || ^8`，匹配本项目 8.3.1。Radix peer 支持 React/React DOM 19，匹配项目 19.3.0；TypeScript 7.0.2 的兼容性由类型检查验证。其余辅助依赖锁定 `class-variance-authority` 0.7.1、`clsx` 2.1.1、`tailwind-merge` 3.7.0；锁文件保留完整传递版本。

## 样式与入口

`@/*` 指向 `src/panel/*`。业务从统一 UI 入口导入，组件内部从 `@/lib/utils.js` 使用类名合并工具。模板仅定向适配工具入口与 `bg-ui-accent`：现有 `--color-accent` 已用于 AG Grid，不能覆盖为 shadcn 的悬停背景。

Tailwind 使用[官方可分离的 theme/utilities 样式入口](https://tailwindcss.com/docs/preflight#disabling-preflight)，不启用全局 Preflight，防止试点重置未迁移控件的浏览器基础样式。工具类扫描仅限 `src/panel/components/ui`，避免为既有 `.grid` 等业务类名生成同名工具类。业务层通过 UI 组件使用样式；若未来需要在其他目录写工具类，先显式扩展扫描入口并核对命名冲突。仅通用 button 基础规则放在 components 层，让 utilities 层为试点 Button 提供样式；其余既有 CSS 保持无层优先级，保留 AG Grid 文案单元格等局部覆盖；AG Grid Quartz 及原有语义变量保持原值。`background/foreground` 对应现有 surface/ink，primary/ring 对应 focus，destructive 对应 error，ui-accent 对应 hover，圆角对应 radius-control。

独立浏览器集成测试仍由 esbuild 打包页面，随后通过与生产相同的 Vite/Tailwind 插件编译同一 `style.css` 为 `test.css`，覆盖 esbuild 未转换的 CSS。测试从可见颜色、边框、点击高度与完整交互核对结果，不检查工具类组合。

## 行菜单（#76）

Context Menu 源码按需取自 [官方 new-york-v4 registry](https://ui.shadcn.com/r/styles/new-york-v4/context-menu.json)（2026-10-07，模板 SHA256 `e9680a7b71840b7203e1625acab8754d7c18122b66289baf281c3a6e31246ada`）。沿用 `radix-ui` 1.7.0，锁文件中的 `@radix-ui/react-context-menu` 为 2.3.8、`@radix-ui/react-menu` 为 2.1.25。仅保留 Root、Trigger、Content、Item，未引入不使用的图标与子菜单；适配 cn 入口、ui-accent、明确实线边框、最小点击高度、视口最大宽度，并映射 popover 主题。无新增依赖。

非模态常驻 Root 和 asChild Trigger 复用原语的真实右键定位、导航、激活及 Escape；鼠标打开先聚焦菜单容器，方向键进入选项。业务校验真实行身份、勾选范围与锁，仅为当前项动态禁用增加焦点落到首个可用项或容器的适配。关闭时按原因恢复稳定片段焦点，非模态外部点击继续激活原目标并保留其焦点，删除和插入将焦点交给现有 Dialog 或文案编辑器。删除弹窗此阶段仍用原生 Dialog。触摸长按不会绕过真实 contextmenu 行身份校验打开旧目标。

浏览器证据覆盖实际主题颜色、三项操作、方向键/Home/End/Enter/Space/Escape、四类动态锁、宽窄及窄高右下边缘、查找勾选与滚动保留、菜单到原生删除确认的焦点交接。完整页面和真实 AG Grid 保持不变，替身只位于 HTTP 客户端边界。

## 删除确认与焦点恢复（#77）

Alert Dialog 源码取自 [官方 new-york-v4 registry](https://ui.shadcn.com/r/styles/new-york-v4/alert-dialog.json)（2026-10-07，模板 SHA256 `03c0d4de131a9b049e9080724666045c8785074af7e07040a0a0f922a810e7c2`），沿用 `radix-ui` 1.7.0 与锁文件中的 `@radix-ui/react-alert-dialog` 1.1.24。保留上游 MIT 许可，省略未使用的 Trigger、Media，适配 cn/Button 入口。Content 加入视口最大高度及纵向滚动、显式实线及 `--color-border` 浅灰边框与主题前景；将默认布局改为 flex，避免模板生成的全局 `.grid` 工具类影响既有同名表格容器。没有调整 legacy CSS 层级，没有增加依赖。

删除目标仍由 App 在打开确认时深拷贝完整 expected 快照。Radix 提供 alertdialog、Title/Description、默认取消焦点、Tab 环绕与 Escape；`DeleteConfirm` 仅为确认按钮动态禁用时补充取消焦点。确认仍通过既有编辑协调器重新申请修改权；结果落地后关闭弹窗，稳定片段身份优先，删除后使用相邻显示行或“更多”后备。虚拟行的滚动定位同步刷新 React DOM，再聚焦新单元格，避免依赖旧节点。轮询重排和删除反馈仍按服务原有规则处理。

等待已确认请求时仍可取消或 Escape 关闭确认；这不撤回已发出的请求。若用户已转去查找，迟到响应不会重新打开确认或抢焦点。失败及结果未知均不自动重试。原有 Dialog 及非试点按钮继续服务设置、素材、配音等浮层；其嵌套与键盘测试保留。

完整试点体积、方法与推广边界见 [试点评估](ui-pilot-evaluation.md)。本节描述源码行为，不能作为本机安装或实际宿主交付成功证明。
