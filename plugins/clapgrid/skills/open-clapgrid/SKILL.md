---
name: open-clapgrid
description: 打开当前本地工作空间固定项目的 ClapGrid 口播片段表格；检查组件、自动连接服务并在 Codex 右侧制作视频。
---

# 打开 ClapGrid

插件根目录为本技能目录的 `../..`；先解析绝对路径。全程中文沟通。

1. 从当前宿主上下文取得本地工作空间根目录和当前聊天 ID（本地执行环境的 `CODEX_THREAD_ID`）。没有本地工作空间时提示先选择或创建工作空间，停止打开；不使用插件目录、临时目录或上次项目。不可让用户另选 ClapGrid 项目目录或端口。
2. 用户明确要求从旧项目迁入时，在首次 open 前读取并完成[显式迁入流程](references/import.md)，取得成功结果后继续日常打开；目标已存在时遵循拒绝结果。
3. Linux 读取 [组件准备流程](references/linux.md)，完成 check。其他系统检查 Node.js 至少 22.13 及 FFmpeg/ffprobe。宿主必须能运行 `codex app-server --stdio` 并读取本聊天；不能核对时停止。Linux 下本文所有 `node <插件根目录>/dist/runtime.js <操作>` 均使用 `bash <插件根目录>/scripts/runtime-linux.sh <操作>`。
4. 经宿主执行审批运行 `node <插件根目录>/dist/runtime.js open --workspace <宿主工作空间绝对路径> --thread <当前聊天ID>`。它会核对宿主当前目录，在固定 `clapgrid/` 子目录创建或恢复项目，并自动发现或启动服务；服务端口无需配置。审批拒绝时报告拒绝原因并停止，不更换路径绕过拒绝。启动未确认时检查日志，不自动重复启动。若提示插件过期，先重载宿主插件；若提示服务版本不一致，执行项目仓库的插件更新流程，保留运行任务，不把旧服务在线当作新版已打开。
5. 在独立调用中执行 `workspace-status`，使用相同 workspace/thread 参数。只有它返回成功才声明在线；核对返回的 workspace、snapshot.project.directory、项目 ID 和 instanceId。数据库、素材、配音及成片保存在该工作空间的 `clapgrid/` 中。
6. 使用 `open_in_codex`，`placement: right`、`target.type: browser`，URL 为刚核对的完整 `url`（保留 `/binding/…` 路径）。返回 queued 时继续检查内置浏览器；只有实际读到表格或用户确认看到才算打开成功。
7. 调用实际加载的 `clapgrid_status`，核对它的项目 ID、项目目录及 instanceId 与面板一致，同时比较 `clapgrid_host_context.buildIdentity`、状态的 `buildIdentity` 和面板“连接诊断”中的版本指纹。版本缺失或不一致时报告未验证／需更新，不宣称已更新可用。业务 MCP 自动读取请求中的宿主聊天身份并发现当前工作空间服务；不得配置 `CLAPGRID_SERVICE_URL`。工具未加载时说明需重载插件，不能以命令行协议测试代替实际宿主验证。

打开不发起配音、导出或片段写入。关闭面板或 MCP 不终止已受理任务；重开先查询，不重发制作请求。宿主工作空间改变后，关闭旧面板并重新执行打开流程；旧项目后台任务继续，旧面板业务请求会因工作空间不符而拒绝。身份无法核对、地址复用或断线时停止操作，不自动重试制作。

用户要求退出服务时执行 `workspace-stop`，使用当前 workspace/thread 参数。有任务返回 `kept`，保持服务；仅用户明确选择“中断任务并退出”后加 `--interrupt`。`stopping` 仅表示已受理，继续查询至旧实例离线。普通 SIGTERM/SIGINT 也默认保持任务，不强制终止。恢复中断任务遵循现有清理与锁规则，不删除锁文件或媒体运行标记。

诊断宿主关联时可调用 `clapgrid_host_context`；roots 不支持不等于没有本地工作空间，进程目录也不是工作空间。旧位置项目仅按显式迁入流程复制，不以 `--project` 作为日常切换入口。
