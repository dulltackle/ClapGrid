# 试点组件维护

遵循 ADR 0002，仅将删除确认中的按钮接入项目内 `src/panel/components/ui/index.ts` 入口。业务继续拥有删除目标快照和修改权规则。

## 来源与版本

2026-10-07 依据 [shadcn/ui 现有 Vite 项目指南](https://ui.shadcn.com/docs/installation/vite) 定向添加 Vite 插件、样式入口、TypeScript/Vite 别名和 `components.json`；未重新生成项目。生成器按需使用固定版本命令 `npx shadcn@4.21.3 add <组件>`（不纳入运行时或常规构建依赖），添加前检查差异，不覆盖业务适配。

Button 源码来自 [官方 new-york-v4 registry](https://ui.shadcn.com/r/styles/new-york-v4/button.json)，采用 Radix 路线（`radix-ui` 1.7.0）。后续试点菜单和确认弹窗沿用同一路线。模板属于本地源码，升级时对照上游审阅，保留本地主题、可访问语义与业务集成；不以重新生成替代审查。

Tailwind CSS 与 Vite 插件锁定 4.3.3，插件 peer 支持 Vite `^5.2.0 || ^6 || ^7 || ^8`，匹配本项目 8.3.1。Radix peer 支持 React/React DOM 19，匹配项目 19.3.0；TypeScript 7.0.2 的兼容性由类型检查验证。其余辅助依赖锁定 `class-variance-authority` 0.7.1、`clsx` 2.1.1、`tailwind-merge` 3.7.0；锁文件保留完整传递版本。

## 样式与入口

`@/*` 指向 `src/panel/*`。业务从统一 UI 入口导入，组件内部从 `@/lib/utils.js` 使用类名合并工具。模板仅定向适配工具入口与 `bg-ui-accent`：现有 `--color-accent` 已用于 AG Grid，不能覆盖为 shadcn 的悬停背景。

Tailwind 使用[官方可分离的 theme/utilities 样式入口](https://tailwindcss.com/docs/preflight#disabling-preflight)，不启用全局 Preflight，防止试点重置未迁移控件的浏览器基础样式。工具类扫描仅限 `src/panel/components/ui`，避免为既有 `.grid` 等业务类名生成同名工具类。业务层通过 UI 组件使用样式；若未来需要在其他目录写工具类，先显式扩展扫描入口并核对命名冲突。仅通用 button 基础规则放在 components 层，让 utilities 层为试点 Button 提供样式；其余既有 CSS 保持无层优先级，保留 AG Grid 文案单元格等局部覆盖；AG Grid Quartz 及原有语义变量保持原值。`background/foreground` 对应现有 surface/ink，primary/ring 对应 focus，destructive 对应 error，ui-accent 对应 hover，圆角对应 radius-control。

独立浏览器集成测试仍由 esbuild 打包页面，随后通过与生产相同的 Vite/Tailwind 插件编译同一 `style.css` 为 `test.css`，覆盖 esbuild 未转换的 CSS。测试从可见颜色、边框、点击高度与完整交互核对结果，不检查工具类组合。
