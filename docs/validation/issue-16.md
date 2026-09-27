# #16 工程骨架验证

2026-09-26（America/Los_Angeles），Ubuntu 24.04.5、Node.js 22.23.3、npm 10.9.9、Codex 26.924.22138。

## 实际执行

- TDD：共享业务层、HTTP、MCP 三个公开边界先出现缺模块失败，逐个实现后单文件测试通过；类型检查在各阶段通过。
- SQLite：临时目录初始化项目标识及创建时间，关闭再打开，业务层返回相同记录和空片段集合。数据库与 `media/` 分开，HTTP 不公开数据库文件。
- `npm run build`：TypeScript 与 Vite 成功；AG Grid 完整 Community 包产生体积提示，当前作为骨架保留。
- `npm run dev -- --project /tmp/clapgrid-issue16-dev --port 48763`：真实服务与 Vite 页面均通过 HTTP 读取；不以此替代 Codex 右侧验证。
- `npm run plugin:build`：生成包含服务、MCP 依赖及面板的插件包；插件清单和技能校验通过。
- 默认沙箱启动返回成功，但下一独立命令查询失败，未认定后台存活。随后通过宿主 `require_escalated` 审批启动，独立 status 返回相同实例。
- 宿主服务：`http://127.0.0.1:48762`，实例 `927d1bf8-3cdf-46ad-bf53-3c1c6d90a743`，PID `195803`，验证目录 `/tmp/clapgrid-issue16-project`。重复 start 返回原实例。
- 右侧：`open_in_codex` 返回 queued 后，使用 Codex In-app Browser 实际打开并读取页面及截图。页面标题“ClapGrid · 口播片段”，显示“本地服务已连接”、上述实例与 PID、六列表头和“暂无口播片段”。未使用外部浏览器替代。
- 构建插件的 MCP 通过 SDK stdio 客户端完成连接、调用 `clapgrid_status`，与 HTTP 返回深比较相等；工具关闭后后台服务继续在线。
- 完整 `npm test`：3 项通过；最终 `npm run typecheck` 通过。
- 构建包复制到仓库外临时目录后，stdio 工具发现和状态查询通过，不依赖仓库的 node_modules。异项目复用被明确拒绝，原服务保持在线。
- HTTP 拒绝 POST、外部 Origin、外部 Host；数据库静态请求返回 404。MCP 服务离线测试返回 `isError`。

## 审查与修复

只读子代理按 open-code-review-delegate 执行 OCR 文件选择和规则解析，19 个可审查文件全部覆盖，并额外核对 7 个被 OCR 排除的新增文件。发现异常 URL 会导致服务退出；新增 HTTP 回归先失败，修复后 service.test.ts 两项通过，类型检查与插件重建通过。

修复后经宿主许可正常停止本轮无任务验证服务，再启动新构建：实例 `95b8a713-3c3d-4b46-b5b2-19b6d60ac16e`，PID `207016`；独立 status 成功，原 SQLite 项目标识保持不变。此前完整套件 3 项通过，审查新增回归后单文件 2 项通过，合计覆盖 4 项测试。

## 边界

本轮只提供工程骨架。项目身份初始化不是完整项目管理，空表格不能编辑，不提供配音与导出。插件包可构建且协议已验证；个人市场安装、新会话技能发现与宿主 MCP 工具加载没有在本轮验证。未重跑完全退出 Codex、Windows、macOS 或三平台安装交付测试。

开发者已在本次会话明确认可中文开发说明、骨架范围及统一提交；说明与范围的人工确认不替代上述运行验证，也不扩展为三平台安装交付验收。
