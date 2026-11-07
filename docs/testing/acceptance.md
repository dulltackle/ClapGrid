# 持续交互验收

## 选择场景

`npm run acceptance` 默认选择空项目。用 `npm run acceptance -- --grep '空项目$'` 或 `npm run acceptance -- --grep '真实成片已导出$'` 显式选择场景。每轮只允许一个场景。宽泛筛选选中多场景时，后续场景在创建现场前报错。

独立配置只收集 `tests/acceptance/**/*.acceptance.ts`，且不启动 Playwright 浏览器。常规 `test:ui` 和 CI 的浏览器阶段不收集这些文件。CI 的 Vitest 进程测试覆盖空项目的信号停止、到期停止与资源清理。

场景通过 API 准备。“真实成片已导出”使用受控配音供应商及真实 `submitExport` 渲染。项目只在本轮新建的临时目录中，服务只监听 `127.0.0.1`。入口不接受用户项目路径或真实供应商选项。

## 启动

在能保持运行的终端会话中启动。

```bash
umask 077
acceptance_root=$(mktemp -d "${TMPDIR:-/tmp}/clapgrid-acceptance.XXXXXX")
export CLAPGRID_PLAYWRIGHT_RUN_DIR="$acceptance_root/run"
# 可选，例如 60 分钟；默认 30 分钟，小数也可用。
# export CLAPGRID_ACCEPTANCE_MAX_MINUTES=60
setsid npm run acceptance -- --grep '空项目$' >"$acceptance_root/stdout.log" 2>"$acceptance_root/stderr.log" < /dev/null &
acceptance_launcher=$!
printf '%s\n' "$acceptance_launcher" >"$acceptance_root/launcher.pid"
ps -o pid,ppid,pgid,sid,lstart,comm -p "$acceptance_launcher"
```

选择真实成片时，将命令中的 `空项目$` 换为 `真实成片已导出$`。每个场景从验收 fixture 初始化起默认存活 30 分钟。`CLAPGRID_ACCEPTANCE_MAX_MINUTES` 接受有限正数，支持小数。

场景就绪后会原子写入 `$CLAPGRID_PLAYWRIGHT_RUN_DIR/acceptance.json` 并在 stdout 输出文件路径。以文件出现为准。启动失败时查本轮 stdout、stderr 和 Playwright 原生报告。报告位置见 [Playwright 运行目录](../agents/tooling.md#playwright-运行目录与中断续跑)。

## 查询

`acceptance.json` 记录场景、源码提交、dirty 状态、面板构建身份、服务 URL 与实例、临时项目、服务所在 worker 的 PID 和 PGID、启动和到期时间，以及候选源码证据范围。

读取记录并核对进程组。PGID 对应 `setsid` 创建的组。

```bash
acceptance_record="$CLAPGRID_PLAYWRIGHT_RUN_DIR/acceptance.json"
cat "$acceptance_record"
acceptance_pgid=$(jq -r .pgid "$acceptance_record")
kill -0 -- "-$acceptance_pgid"
ps -eo pid,ppid,pgid,sid,lstart,comm | awk -v group="$acceptance_pgid" 'NR == 1 || $3 == group'
```

`kill -0` 只说明组仍存在。继续核对记录的 PID、PGID、启动时间与命令，避免操作已被复用的 PGID。

## 实际浏览器验收清单

在实际连接的浏览器中打开 `acceptance.json` 记录的 `serviceUrl`。

1. 在这个浏览器中读取 `navigator.userAgent`、`document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"')` 和 `document.createElement('video').canPlayType('video/webm; codecs="vp8"')`。记录观察时间、浏览器名称和三项原始结果。
2. 在“真实成片已导出”场景中按探测结果选择成片或兼容预览路径。打开面板的任务记录，核对真实导出成功和成片链接；观察播放、时长、`currentTime` 推进与媒体错误，记录实际结果。编码不支持时记录能力限制，不靠改测试源码延长现场。
3. 记录本轮 `acceptance.json`、源码提交与 dirty 状态、面板构建身份、服务实例及截图。

## 停止与核对

正常停止优先向已核对的组发送 `SIGTERM`，也可发送 `SIGINT`。

```bash
kill -TERM -- "-$acceptance_pgid"
```

fixture teardown 沿用 `useProject`，关闭服务、确认媒体资源退出后删除临时项目。验收专用 preload 让媒体守护进程忽略组的 INT/TERM，由已有 IPC 关闭流程释放它。fixture 停止时会在 `acceptance.json` 原子追加 `stop`，包括 `reason`（`signal`、`expired` 或 `interrupted`）、`stoppedAt` 及 `cleanup.projectRemoved` 和 `cleanup.serviceClosed`。原因是 `signal` 时还记录信号名，出错时可附 `error`。

停止后核对原因与两个 `cleanup` 字段，确认两项均为 true、端口关闭、临时项目删除且本轮进程组已退出。到期正常停止应退出 0，SIGINT 可能由 Playwright 以 interrupted 报告。停止记录与本轮日志按[验收原件与手动收尾](../agents/tooling.md#验收原件与手动收尾)处理。

## 手动恢复

`SIGKILL`、终端会话被强制销毁或其他异常终止不能运行 teardown。没有完整 stop 记录或清理结果为 false 时保留现场，不自动处理旧轮次。手动恢复时：

1. 从该轮 JSON、launcher.pid 和日志取精确 PID/PGID、临时项目路径及时间；用上述 `ps` 命令确认原进程组。若身份不符或无法确认，停止操作，保留现场。
2. 原组仍在则先 `kill -TERM -- "-$acceptance_pgid"`，核对后仍有残留才对同组发 `SIGKILL`；不按进程名扫描或终止其他工作树资源。确认本轮媒体命令及守护进程均已退出。
3. 确认端口关闭、资源释放，并核对 `projectDirectory` 确为该轮新建临时项目后，才手动 `rm -r -- <该轮精确临时项目路径>`。不能据此删除用户工作空间或 `clapgrid/`。其他保留目录仅在本轮日志能证明归属且资源已释放时按精确路径处理，不按通配符扫除。
4. 记录异常、人工处理结果及原报告，换新运行目录重开；不伪造旧轮的正常停止或补写为验收通过。

## 证据边界

入口固定标注 `evidenceScope: candidate-source-service`，只证明候选源码服务及其独立面板。`candidate-panel` 身份的指纹对应这轮面板构建，不是完整插件包身份。正式交付所需的安装包和实际宿主证据按[本机插件交付](../agents/plugin-delivery.md)单独核对。此入口不探测浏览器、不新增产品探测端点、不修改成片或兼容预览契约。
