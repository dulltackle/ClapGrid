# 统一组件维护

## 全站约定

页面及业务静态样式由所在 TSX 的 Tailwind 工具类拥有，通用控件从 `src/panel/components/ui/index.ts` 使用（ADR 0002）。业务继续拥有删除目标快照、草稿和修改权规则，组件不管理业务状态。保持亮色，表格强调色 `--color-accent` 与控件悬停色 `ui-accent` 分开：`--color-accent` 已用于 AG Grid，不能覆盖为 shadcn 的悬停背景。

`style.css` 仅保留主题映射与变量、根字体/亮色、页面高度及滚动约束、全局可见键盘轮廓和限定的第三方适配；不新增全局 button/input/textarea/summary 规则或业务选择器，样式依赖显式工具类而非浏览器默认 margin。

### 必要例外与原因

- `.ag-cell[col-id="text"]` 是唯一无层单元格适配：AG Grid 注入的无层 display 规则优先于 utilities 层，直接使用 cellClass 工具类会使正文失去垂直居中，不能通过扩大样式冲突例外规避。
- AG Grid 36.2.0 的行悬浮监听只处理 `mouse`，而实际宿主可能先发送 `pointerType=pen`，导致高亮延迟。因此表格设置 `suppressRowHoverHighlight`，由原生 `:hover` 驱动高亮，并以限定于 `.segment-grid` 的适配复用 Quartz 覆盖层；浏览器测试须分别发送 `pen` 和 `mouse`。
- 表格容器使用 `.segment-grid` 而非 `.grid`，Alert Dialog、Dialog 改用 flex，均为避免与标准 `.grid` 工具类冲突；扩大工具类扫描范围前先核对命名冲突。
- 原生 audio/video 的播放控件、NativeSelect 的箭头与选项由浏览器拥有；文案编辑器、缩略图与拖动手柄保留专用尺寸与输入规则，不强制套普通组件尺寸。
- 查找展开行高、拖动指示线位置等来自真实测量的值保留动态 style；这些例外不豁免静态样式重写。
- 依赖升级时须复核上述第三方覆盖层与内部主题变量。

## 自动样式门槛

`npm exec vitest -- run tests/style-collisions.test.ts` 解析生产同源编译的 utilities 层与项目 CSS 类名，发现同名冲突即失败。例外集中于 `scripts/style-collision-exceptions.json`，每项须写完整 className 和经审查的 reason；优先消除冲突，例外不是忽略整类检查的开关。

`tests/helpers/theme-contract.ts` 集中维护可见主题契约。修改主题时同时审查矩阵预期，不能为了通过测试降低可见性要求。浏览器测试从可见颜色、边框、点击高度与完整交互核对结果，不检查工具类组合；替身仅位于 HTTP 客户端边界。

## 来源与版本

依据 [shadcn/ui 现有 Vite 项目指南](https://ui.shadcn.com/docs/installation/vite) 接入。生成器按需使用固定版本命令 `npx shadcn@4.21.3 add <组件>`（不纳入运行时或常规构建依赖），添加前检查差异，不覆盖业务适配。依赖升级必须单独审查。

模板属于本地源码，采用 Radix 路线并保留上游 MIT 许可；升级时对照上游审阅，保留本地 cn 入口、亮色主题、浅灰实线边框、可见焦点、可访问语义与业务集成，不以重新生成替代审查。各模板来自官方 new-york-v4 registry：

| 组件 | 来源与模板摘要 |
| --- | --- |
| Button | [button.json](https://ui.shadcn.com/r/styles/new-york-v4/button.json) |
| Context Menu | [context-menu.json](https://ui.shadcn.com/r/styles/new-york-v4/context-menu.json)，SHA256 `e9680a7b71840b7203e1625acab8754d7c18122b66289baf281c3a6e31246ada` |
| Alert Dialog | [alert-dialog.json](https://ui.shadcn.com/r/styles/new-york-v4/alert-dialog.json)，SHA256 `03c0d4de131a9b049e9080724666045c8785074af7e07040a0a0f922a810e7c2` |
| Input | [input.json](https://ui.shadcn.com/r/styles/new-york-v4/input.json)，SHA256 `b1fffa12ba72ce30a291749012b47235eda110648b8106725ced22b5b31c8f1b` |
| NativeSelect | [native-select.json](https://ui.shadcn.com/r/styles/new-york-v4/native-select.json)，SHA256 `950729a758bef332865adc55f25c16667f45347ef850ee7be20b741667f55d8b` |
| Dialog | [dialog.json](https://ui.shadcn.com/r/styles/new-york-v4/dialog.json)，SHA256 `0115e3a57aa55a978c5fed0d77f7e98edd694215aae3e569def3fff722ba9f26` |
| Textarea | [textarea.json](https://ui.shadcn.com/r/styles/new-york-v4/textarea.json)，SHA256 `2367d3964326b19ca2355f872d08153c86932abd4b103b5fd02039a3f2cb8ae5` |
| Dropdown Menu | [dropdown-menu.json](https://ui.shadcn.com/r/styles/new-york-v4/dropdown-menu.json) |

图标采用 [Radix Icons](https://www.radix-ui.com/icons)，不以文字符号模拟。

设计质量检查参考 [Impeccable 官方仓库](https://github.com/pbakaus/impeccable/tree/d631a8827f99414d2b6daba4ef08b7f8701751d7)（Apache-2.0）的 audit 维度：可访问名称、键盘焦点、减少动态效果、主题令牌、视口溢出及无多余依赖，以浏览器测试核对；不安装其全局技能、引擎或钩子，也不将其自动检测器结果当作证据。
