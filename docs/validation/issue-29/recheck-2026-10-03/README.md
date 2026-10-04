# #29 当前环境复查（2026-10-03）

用户选择继续当前环境，未提供干净 Linux 桌面。本轮基线为 `0a93bd3`，不改产品代码，仅追加独立验证记录；历史证据见 [前轮续验](../session-2026-10-03/README.md)。日期按 America/Los_Angeles，服务时间为 UTC。

## 执行结果

- Ubuntu 26.04.1 LTS、x86_64，Node.js 22.23.3、FFmpeg/ffprobe 8.0.1-3ubuntu2。已安装插件版本 `0.1.0+codex.20261004022000`。未重新测量 Codex 桌面版本。
- 正式安装缓存执行 `scripts/runtime-linux.sh check` 退出 0。Linux 组件测试 3 项通过、1 项因非 Ubuntu 24.04 跳过，见 `components.txt`；覆盖缺组件反馈、缺字体工具反馈、断网重复安装复用。没有在宿主执行缺组件安装。
- 当前会话实际发现并调用正式 `clapgrid_status`、`clapgrid_export_status`、`clapgrid_submit_export`。命令行 status 和 MCP 返回同一项目及实例 `ecf7f93c-d961-42e9-9bbe-0e655bd5bc46`、PID 3088929，与前轮相同，见 `service-status.json`。本轮没有停止或重启服务，没有重跑 start。
- 首次误用历史端口 48929，普通及宿主权限下 status 均报 `fetch failed`，内置浏览器报连接拒绝。改用默认端口 48762 后成功；这不是沙箱网络限制。以当前 status 返回的 URL 为准，不能直接沿用历史验证端口。
- Codex 右侧内置浏览器实际打开 `http://127.0.0.1:48762/`，读取“本地服务已连接”“已保存”、两条口播片段及有效配音。`open_in_codex` 的 queued 本身不计成功。服务和表格保留。
- 自动化点击“试听”时，AX 和 Playwright 均返回 `Could not check the click target's shadow root`；Playwright 能定位唯一、可见且启用的按钮，但点击未完成。因此本轮未复测音视频浏览器播放，不将工具失败归因于产品，也不声称再次人工听音。沿用前轮用户已确认的听音证据。
- 正式 MCP 受理新导出 `36696fde-9b25-4a0e-8c24-50d04b0c96e5`，再次查询为 succeeded、2/2，见 `export.json`。使用现有两条真实配音和本地合成测试图视频，没有新请求配音供应商。第二条仍有末帧冻结提示。
- 新成片为 H.264/AAC、1920×1080、25 fps、16.96 秒，见 `output-probe.json`。对 `export.json` 中的 output.path 执行 `ffmpeg -v error -xerror -i <路径> -f null -` 完整解码，退出 0。SHA-256 为 `f221114f9fcbe4d39ca2b9c4e67afd6e7ecf59c9bab2673d45f6cdb2a4b1a925`。同一内容生成的新文件与前轮摘要相同，任务标识和输出路径不同；未把历史文件算作新导出。本轮没有视觉复查字幕，字幕画面证据沿用前轮。
- `npm run typecheck` 通过；`npm run plugin:build` 通过，见 `build.txt`，本轮没有重新安装构建产物。
- 完整 `npm test`：130 项中 129 通过、0 失败、0 取消、1 跳过，见 `full-suite.txt`。前轮浮层回归问题本次未复现；单次通过不表示已修复其不稳定性。

## 验收边界

已有第 1、2、4、6 条历史证据保留，本轮只复测上述可执行范围，未重跑 Ubuntu 24.04 容器安装、真实缺组件恢复或审批拒绝。第 3 条补充本轮 MCP、表格读取与新导出证据；播放和人工听音沿用前轮，不冒充本轮已重跑。

第 5 条仍未完成：当前系统已有组件，且自动安装器只支持 Ubuntu 24.04。没有干净 Linux Codex 桌面的正式首装证据，不能以容器或现有组件复用替代。#15 继续承接原型首装，跨完整退出的最终验收仍按 #26 分工。本轮不新增验收勾选，#29 保持开放，不推送。
