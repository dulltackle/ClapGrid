# 面板亮色样式规范

本规范对应 #31，固定参考 Codex 26.924.22138 默认亮色打包值。实际宿主截图比对状态见 `validation/issue-31/README.md`。样式在项目内维护，不读取安装目录、宿主主题或系统深浅色偏好。

## 语义变量

唯一来源为 `src/panel/style.css` 的 `:root`；AG Grid 通过 `themeQuartz.withParams` 引用相同变量。

| 用途 | 变量 / 规则 |
| --- | --- |
| 主表面、弱化区域 | `--color-surface` 白色；`--color-surface-subtle` 浅灰 |
| 正文、辅助文字 | `--color-ink` #1a1c1f；`--color-ink-secondary` |
| 强调、键盘焦点 | `--color-accent` #339cff；`--color-focus` 深蓝，保证白底可见 |
| 分隔线、悬停 | `--color-border`；`--color-hover` |
| 错误文字、错误背景 | `--color-error`；`--color-error-surface`，同时提供文字说明 |
| 字体 | `--font-ui` 系统字体栈，正文 14px，辅助文字 12px，标题 18px / 600 |
| 间距 | 4px 基础单位：`--space-1/2/3/4/6` 对应 4/8/12/16/24px |
| 圆角 | `--radius-control` 6px；`--radius-panel` 8px |

## 使用规则

- 页面留白宽屏 24px，600px 以下 16px；避免添加独立品牌色、装饰徽章和工程占位文案。
- 表格头部与行高均为 40px，字号 14px，间距基础单位为 4px。六列保留，文案列 `flex: 1` 且最小 200px，其余列固定初始宽度、允许调整。
- 容器保持 `min-width: 0`，由 AG Grid 自身承担横向滚动，不通过隐藏业务列适应窄屏。
- 连接提示持续可见；初次请求期间显示连接中，失败显示错误及读取失败提示，成功且无片段才显示空态。
- 路径、服务实例、PID 放在默认折叠的原生 `details/summary` 内；长文本使用 `overflow-wrap: anywhere`。
- 交互控件使用悬停、按下和 `:focus-visible` 状态；键盘焦点为 2px 深蓝轮廓。保留表格原生键盘导航和焦点样式。
- 只为现有控件定义规则。新增组件应复用语义变量，不提前制作无功能控件。
