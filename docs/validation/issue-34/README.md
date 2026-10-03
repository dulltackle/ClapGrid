# #34 口播片段面板整体验收

2026-10-03，在 `71f024f` 的产品实现上重新验证。#35–#39 已交付本规格的功能，本轮补齐总事项验收、当前版本截图与规范索引，没有再次修改业务实现。

## 验收映射

以下项目均在本轮实际执行；测试通过不等于真实提供商、跨平台或读屏器验证。

| #34 验收标准 | 执行证据 |
| --- | --- |
| 表头直接可见，表格填满顶部和底部之间 | `layout-panel.test.ts` 宽窄视口空间关系、整页高度和表格滚动断言；本轮 Codex 宿主测量 |
| 五列顺序及文案宽度优先 | `layout-panel.test.ts` 五列可达；`media-panel.test.ts` 宽度和行内控件边界；宿主宽屏五列表头 |
| 长文案三行摘要、全文编辑、保存取消 | `long-text-panel.test.ts` 宽窄摘要尺寸、全文输入、Enter／Esc、输入法及轮询；宿主双击全文编辑并 Esc 取消 |
| 低频功能按需打开且不推移表格 | `layout-panel.test.ts` 五项更多入口、诊断、浮层边界和表格矩形；宿主声音设置 |
| 有勾选才显示操作，包含隐藏项 | `selection-panel.test.ts` 勾选／取消、隐藏项请求范围及项目顺序移动；宿主隐藏勾选截图 |
| 浮层关闭恢复位置焦点，仅查看无修改 | `dialog-panel.test.ts` 键盘、虚拟滚动、轮询、删除重排回退；`layout-panel.test.ts` 零修改请求；宿主声音设置关闭回到更多 |
| 保存、断线及任务异常持续且不抢焦点 | `editing-panel.test.ts` 保存与断线时序；`export-panel.test.ts` 错误跨连接恢复和详情开关持续，未自动弹层 |
| 锁定、可能计费、有效配音与失败独立表达 | `export-panel.test.ts` 锁定及异常；`media-panel.test.ts` 有效叠加失败、待更新叠加未知、请求保护及锁定时试听；宿主宽屏截图 |
| 窄屏所有业务列保留，表格内部横纵滚动 | `layout-panel.test.ts` 实际滚动尺寸及列可达；宿主 420×720 页面与表格尺寸 |
| 始终全片导出，业务互斥不变 | `export-panel.test.ts` 筛选勾选后请求无范围参数、任务取消和重复请求保护；全量编辑、配音与导出业务测试 |
| 更新规范并提供浏览器与宿主证据，标记未验证项 | 更新 `docs/panel-style.md` 整体验收索引；本目录本轮截图、执行结果及下方限制；链接和图片文件完整性检查 |

## 真实浏览器截图

真实 React 主视图、生产 CSS 与 AG Grid，仅在既有 HTTP 客户端边界提供确定响应。布局场景含 60 个片段，其他场景按各回归提供长文案、长素材名、任务及异常。

| 状态 | 1600×1000 | 420×1000 |
| --- | --- | --- |
| 默认布局 | [查看](1600-normal.png) | [查看](420-normal.png) |
| 全文编辑 | [查看](1600-editing.png) | [查看](420-editing.png) |
| 勾选与筛选 | [查看](1600-selected-filtered.png) | [查看](420-selected-filtered.png) |
| 配音独立状态 | [查看](1600-speech-states.png) | [查看](420-speech-states.png) |
| 任务进行中 | [查看](1600-task-running.png) | [查看](420-task-running.png) |
| 持续异常 | [查看](1600-persistent-error.png) | [查看](420-persistent-error.png) |
| 任务浮层 | [查看](1600-tasks.png) | [查看](420-tasks.png) |

截图复现命令：

```sh
PANEL_EVIDENCE_DIR=docs/validation/issue-34 npx tsx --test tests/layout-panel.test.ts tests/long-text-panel.test.ts tests/selection-panel.test.ts tests/media-panel.test.ts tests/export-panel.test.ts tests/dialog-panel.test.ts
```

## 本轮 Codex 宿主验证

使用 Codex 内置浏览器打开临时验证页 `http://127.0.0.1:48734/`，现场构建当前 App 与生产样式，复用 `tests/helpers/editing-fixture.ts`。60 个片段，每条包含长文案和长素材名，前五条覆盖失败、未知、已受理、生成中及成功；前两条分别有有效和待更新音频。缩略图为示意图，非真实项目媒体。截图为内置浏览器内容，不含宿主窗口边框。验证后恢复默认视口。

- [420×720 总览](codex-420-overview.jpg)：表格 top=112、height=501、bottom=613；页面 scrollWidth=420、scrollHeight=720，无整页溢出。表格横向可见 387px、内容 1030px；纵向可见 443px、内容 4800px。
- [声音设置](codex-420-settings.jpg)：表格仍 top=112、height=501；浮层边界 x=17–403、y≈199–521；焦点在浮层内，关闭后 activeElement 文本为「更多」。
- [隐藏勾选](codex-420-selection.jpg)：选中第一条后按「口播片段 2：」筛选，首条隐藏、可见序号为 2、12、22 等，仍显示「已勾选 1 个片段（含筛选隐藏项）」。自动化 checkbox 的即时回执一度报告失败，随后读取实际界面已选中，未重复点击；以最终可见状态为准。
- [全文编辑](codex-420-editing.jpg)：双击第一条文案打开「文案全文」，Esc 后编辑器数量为零；未提交文案修改。
- [1600×1000 总览](codex-1600-overview.jpg)：五列表头顺序保持；表格 top=116、height=773；页面 scrollWidth=1600、scrollHeight=1000。有效配音与最近失败、待更新与未知计费并列可见。

此前子事项的宿主任务、素材详情和滚动交互记录仍可追溯：[主视图](../issue-36/README.md)、[全文编辑](../issue-37/README.md)、[勾选](../issue-38/README.md)、[紧凑单元格](../issue-39/README.md)。这些历史截图不冒充本轮新截图。

## 执行结果与限制

- `npm run typecheck`：通过。
- 上述六个浏览器测试文件：13/13 通过，无跳过。
- `npm run build`：通过，保留既有超过 500kB 的包体提示。
- `PATH="/tmp/clapgrid-ffprobe6:$PATH" npm test`：130 项，129 通过、0 失败、1 跳过。使用既有 ffprobe 6.1.1 测试工具，未更改系统安装；系统 ffprobe 8 的兼容差异不在本次范围。
- 跳过的既有 Linux 测试为「安装基础工具缺失时说明原因与重试方式，恢复组件后重试成功」，没有计为通过。
- 未调用付费配音提供商，宿主未使用真实音视频验证播放解码；未验证其他操作系统、其他浏览器或读屏器。客户端替身用于布局及请求语义验证，不证明外部配音和真实媒体输出质量。

## 独立只读审查

一个子代理按 `open-code-review-delegate` 执行 OCR preview/rule。工作区 21 个文件（两份文档、19 张图片）因文档或二进制规则被 OCR 默认排除，已全部手动审阅，跳过 0、覆盖率 100%。同时对 `97aefa9..71f024f` 的 11 个可审查实现文件执行规则审查，并补审 7 个面板测试文件；未发现需要修复的问题。审查确认 11 条验收映射与测试、截图一致，未将跳过项或历史截图当作本轮通过证据。
