# 本机插件交付

源码合并、安装成功和宿主加载是三个独立阶段。涉及本机插件的工作按下列流程收尾；用户已有更新授权时继续执行，受保护路径仍走宿主审批。

1. 完成代码检查并记录目标提交。用 `codex plugin marketplace list --json`、`codex plugin list --json` 和实际 `clapgrid_host_context` 确认当前安装来源。只更新对应的 ClapGrid 市场条目，保留其他插件与配置。
2. 从干净的目标提交执行 `npm run plugin:update -- --revision <提交> --marketplace-root <市场根目录> --cache-root <Codex 插件缓存根目录> --workspace <当前工作空间> --thread <当前聊天ID>`。参数必须来自当前宿主与安装信息。此命令构建完整包、校验指纹、保存恢复包、通过 `codex plugin add` 安装并正常重启空闲服务。
3. 有任务或编辑占用时保持服务，等待用户结束后再更新。失败以返回的 `backup`、`rollback`、`rollbackError` 为准；`needs-attention` 时保留现场和恢复目录。更新仅操作插件包和服务生命周期，不迁移、删除或重建 `clapgrid/` 项目。
4. 安装成功返回 `host: reload-required`、`complete: false`。使用宿主支持的插件重载入口；若当前工具无法重载，明确告知用户“安装已完成，宿主仍需重载”。不能用另起一个 MCP 测试进程代替实际调用证据。
5. 重新调用实际 `clapgrid_host_context` 和 `clapgrid_status`，打开真实面板的“连接诊断”，核对目标构建、安装包、MCP、服务及面板指纹，以及工作空间、服务实例。保存本次实际观察后运行 `npm run plugin:verify -- --build <构建包> --installed <安装包> --workspace <工作空间> --service-url <服务根地址> --mcp-evidence <宿主证据> --panel-evidence <面板证据>`。缺失、过期、不一致或受控测试证据均不能通过交付门槛。
6. 最终报告分别列出源码提交／合并状态、本机安装版本、实际宿主验证结果。仅第 5 步退出 0 才称“已更新可用”；其余状态报告尚未完成的具体环节和恢复位置。

## 证据格式

证据有效期为 5 分钟，只证明采集时刻。`observedAt` 使用实际采集时间；字段取自真实返回，不推测。`controlled-test` 只用于测试，不能作为正式交付证据。

宿主证据：`{ "source": "actual-host", "observedAt": "ISO时间", "status": "reachable", "response": <实际clapgrid_host_context结构化结果>, "serviceStatus": <实际clapgrid_status结构化结果> }`。

面板证据：`{ "source": "actual-browser", "observedAt": "ISO时间", "status": "reachable", "response": { "buildIdentity": <已加载页面自身的__CLAPGRID_BUILD_IDENTITY__>, "instanceId": <面板诊断显示的服务实例>, "workspace": <已核对的工作空间> } }`。同时保留诊断截图；通过 DOM 可见内容核对实例及版本，不能只请求服务接口冒充面板。

更新收据位于 `${XDG_DATA_HOME:-$HOME/.local/share}/clapgrid/plugin-update.json`，供新版打开入口和 MCP 检查已加载版本是否过期；从指定源码提交更新时还记录来源仓库，后续已提交的插件代码变化会触发更新提示（纯合并且文件不变不误报）。收据不是宿主成功证据。恢复包默认位于同目录的 `updates/` 下，结果含精确路径。更新锁残留时先检查原更新进程及结果，确认恢复策略后再处理，不自动抢占锁。
