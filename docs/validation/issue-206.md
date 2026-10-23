# #206：成片交付的浏览器检查

2026-10-23，本轮在源码基线 `6d8abe5` 上扩展 `tests/export.spec.ts` 的既有真实成片测试。复用一次渲染，保持成片为 H.264 MP4；不修改产品行为、安装包或已加载插件。

## 自动回归范围

- Google Chrome 中实际点击“打开成片”，提前等待原生 popup，核对新页 URL 为任务的绝对 `previewUrl`。
- 兼容预览满足 `readyState >= 2`、未暂停、时长接近两秒配音 fixture，并从采样起点前进超过 0.2 秒。主动调用 `play()`，不验证自动播放策略。
- 实际点击“下载 MP4 原片”，提前等待原生 download；核对无失败、文件名以 `.mp4` 结尾、保存文件的字节数和 SHA-256 与服务端成片一致。
- 保留下划线样式、可访问名称定位，以及任务记录到连接诊断的键盘链；删除 href、download 属性和 HTTP 200 的旧断言。
- 既有 Vitest 媒体保障保持独立，不重复编码矩阵。

临时将产品“打开成片”链接改指 MP4 后，新断言在 popup URL 核对处失败（预期 `/preview`，实际 `/file`）；恢复产品文件后通过。临时改动不纳入提交。

## 原规格前提失效与实际内置浏览器

锁定 `@playwright/test` 1.64.1 的浏览器清单将 Chromium 标为 Chrome for Testing（revision 1248）。通过原生 `playwright.chromium.launch()` 启动的默认 headless 浏览器实测能播放本轮 H.264 MP4：`readyState=4`、`paused=false`，`play()` 无错误。因此规格要求的 MP4 反向检查失败；不能用它声称验证了无专利解码器环境，也不增加无效的 CI Chromium 安装步骤。[Playwright 浏览器文档](https://playwright.dev/docs/browsers)中的一般编解码说明不能代替本版本的实测。

用户在获知该结果后明确要求“测试 Codex 内置浏览器兼容性”。本轮使用当前聊天实际连接的 ChatGPT in-app browser，打开现有测试同一次渲染的临时项目，而非另建导出 fixture；测试服务在观察结束后由原有 fixture 清理。

2026-10-23 02:08:43（America/Los_Angeles，`09:08:43.806Z`），实际内置浏览器播放兼容预览的结果：

| 观察项 | 起点 | 终点 |
| --- | --- | --- |
| readyState | 4 | 4 |
| paused | false | false |
| duration | 2.009 秒 | 2.009 秒 |
| currentTime | 0 秒 | 0.318914 秒 |

实际推进 0.318914 秒，无媒体错误，画面正常。当前内置浏览器也能播放同一 H.264 MP4（`readyState=4`、`paused=false`、时长 2 秒、`play()` 无错误），故不能沿用旧版本“不支持 H.264”的结论。

实际内置浏览器中点击“打开成片”后，工具未列出可操作的新标签页；兼容预览播放通过是直接打开页面上观察到的准确预览地址获得的。不能据此声称内置浏览器的新标签入口已通过，也不能仅凭工具未列出标签判定产品故障。Chrome 的点击及 popup 已由自动测试覆盖。

这是一次实际内置浏览器的播放验证，不是 CI 内置浏览器自动化，也不是已安装插件的完整交付认证。无专利浏览器自动回归仍未建立；真实 CI、本机安装和实际 MCP/服务/面板身份核对分别报告，不能由本次观察替代。

原始日志、媒体状态与截图保存在仓库外 `/tmp/clapgrid-206/`，续接入口为 `continuation.md`；临时目录不保证跨机器或长期保存。

## 单轮耗时

环境：Linux x86_64、Node.js 22.23.4、Google Chrome 156.0.8078.47；两轮均在同一工作树通过 Playwright 全局准备构建面板，依赖已安装。运行命令均为 `npx --no-install playwright test tests/export.spec.ts -g '真实成片'`。

- 改前：测试体 4.6 秒，Playwright 总计 6.8 秒；日志 `/tmp/clapgrid-206-baseline.XYM4ac/output.log`。
- 改后 Chrome 检查：测试体 5.2 秒，总计 6.9 秒；日志 `/tmp/clapgrid-206-chrome.qmvfrT/output.log`。

改后额外执行真实 popup 播放及下载检查，并从原测试的 `mpeg4` 改为规格要求的 `libx264`；范围不完全相同。这只是单轮观察，不能推断稳定耗时变化。实际内置浏览器观察另有人工工具操作和等待，不计入这组自动运行比较。

## 最终本地检查

`npm run check` 退出 0：类型检查通过，Vitest 65 个文件/669 项通过，Playwright 169 项通过，生产构建成功。日志 `/tmp/clapgrid-206-check.1trNBk/output.log`，退出码文件同目录 `exit-code.txt`；Playwright 原生 JSON/HTML/附件位于工作树 `logs/`。只读 OCR 子代理审查未发现有效修复项。真实 GitHub CI 未执行，仍待验。
