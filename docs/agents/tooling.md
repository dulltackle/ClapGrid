# 工具定位与日志留存

直接使用现有 CLI、shell 和测试框架的原生报告。解释器用 `command -v` 定位并按需核对版本；技能用 `realpath` 解析真实文件，以真实文件所在目录解析相对引用。已知路径失效时检查对应技能根和链接目标。

## 查询与读取

GitHub 单事项按任务选择 `gh issue view --repo dulltackle/ClapGrid <编号> --json <字段>`；REST 列表使用 `gh api --method GET --paginate --slurp`，用 `--jq` 投影必要字段。分页响应按接口结构处理；Search 和嵌套连接的结果限制另行核对。仅在查询成功且分页已收齐时报告全量。

长日志优先保留原生文件，用 `rg -n` 定位错误、`sed -n` 读取相关行；JSON 用 `jq` 选取必要字段。超长单行先选取字段或分段读取。默认反馈命令结果、关键错误和文件位置；显示截断只描述本次展示，不代表源文件残缺。

查询进程时先取 PID、父 PID、运行时间和命令名；只对需要调查的进程读取完整参数。工具已返回运行会话时，使用其等待入口获取结果。

## 执行与留存

使用每次运行独立的目录，保留 stdout、stderr 和实际退出码，避免后续执行覆盖失败现场。优先使用 Vitest、Playwright 和 GitHub Actions 的原生报告及附件。需要普通命令日志时，可直接使用 shell，例如：

```bash
set -eu
umask 077
run_dir=$(mktemp -d "${TMPDIR:-/tmp}/clapgrid-check.XXXXXX")
if npm run typecheck >"$run_dir/stdout.log" 2>"$run_dir/stderr.log"; then
  command_status=0
else
  command_status=$?
fi
printf '%s\n' "$command_status" >"$run_dir/exit-code.txt"
printf 'exit=%s logs=%s\n' "$command_status" "$run_dir"
exit "$command_status"
```

根据任务在续接记录中注明实际命令、工作目录、源码提交与日志位置。使用流水线时启用 `set -o pipefail`，分别判断生产命令和日志写入是否成功。文件存在、空输出或保存成功均不证明命令成功；失败时保留已有日志，退出状态未取得时明确为未知。取消和未执行不算通过。

文件重定向和原生报告不会自动脱敏。查询时排除认证配置、环境秘密及供应商请求原文，只采集必要字段；可能含凭据的输出先在来源处过滤，共享前再检查内容。任务日志采用私有目录和文件权限，不把旧工具的自动脱敏能力当成原生工具保证。

## Playwright 运行目录与中断续跑

直接执行 `npm run test:ui` 或 `npm exec playwright -- test` 时，配置在主进程生成 `logs/playwright/<UTC 时间戳>-<pid>/`，并写回 `CLAPGRID_PLAYWRIGHT_RUN_DIR`，各 worker 继承同一目录。固定布局为 `results/`（附件）、`report/`（HTML）和 `report.json`（JSON）。未预设目录时，非 CI 的交互终端可按 HTML reporter 结束时打印的路径定位；重定向输出的非交互运行不会打印该提示，可用 `find logs/playwright -mindepth 1 -maxdepth 1 -type d -print` 列出目录，并按时间戳、PID 核对本轮。需要确切定位时优先显式设置目录。

需要命令日志时，调用者预设一个不存在或为空的目录，再把 stdout/stderr 写入同目录；显式目录在配置加载时已非空会报错，不能预先在里面创建日志文件。下面先在目录外用 `tee` 暂存日志，命令结束后再移入该轮目录：

```bash
umask 077
set -o pipefail
export CLAPGRID_PLAYWRIGHT_RUN_DIR="$(pwd)/logs/playwright/$(date -u +%Y-%m-%dT%H-%M-%SZ)-$$"
run_log=$(mktemp "${TMPDIR:-/tmp}/clapgrid-playwright.XXXXXX")
if npm run test:ui 2>&1 | tee "$run_log"; then
  run_status=0
else
  run_status=$?
fi
mkdir -p "$CLAPGRID_PLAYWRIGHT_RUN_DIR"
mv "$run_log" "$CLAPGRID_PLAYWRIGHT_RUN_DIR/command.log"
printf '%s\n' "$run_status" >"$CLAPGRID_PLAYWRIGHT_RUN_DIR/exit-code.txt"
```

外层终止不代表浏览器和其他子进程已退出。需要可控中断时，可使用 `setsid node_modules/.bin/playwright test` 启动原生入口并记录该次 PID/PGID（后台启动后用 `ps -o pid,ppid,pgid,sid,comm -p "$!"` 核对）。续跑前用 `ps -eo pid,ppid,pgid,sid,comm` 按记录的 PGID 核对原组；必要时只对该组发送信号（例如 `kill -TERM -- "-$run_pgid"`，仍有残留才 `kill -KILL -- "-$run_pgid"`），确认该组退出后换新目录重跑。禁止按进程名扫描终止其他运行或其他工作树的资源；不自动判断或清理旧运行。进程已退出也不表示强制中断时报告已完整保存。

历史目录不自动轮换、删除，也没有 `latest` 链接。确认对应运行及其进程组已退出、证据不再需要后，先列出 `find logs/playwright -mindepth 1 -maxdepth 1 -type d -print`，再按明确目录手动清理，例如 `rm -r -- logs/playwright/<已核对的运行目录>`；不要对仍在运行的目录执行清理。

## 旧工具退出

`agent-tools.mjs` 及其专属测试、夹具已退出，不保留兼容命令或自定义日志格式。历史研究与验证记录保留当时结论；其中旧命令不再是执行入口。其他检查、产品工具与资源 helper 继续使用现有实现。

## 持续交互验收的启动、查询与停止

使用独立配置保持现场，无需改写测试源码或延长自动测试。裸入口默认空项目，每轮只允许一个固定场景；需要实际成片时把下面的 `空项目$` 换为 `真实成片已导出$`。在能保持运行的终端会话中执行：

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

就绪标志只有 `$CLAPGRID_PLAYWRIGHT_RUN_DIR/acceptance.json`，路径也会打印在 stdout；没有停止文件或控制通道。启动失败看本轮 stdout/stderr 和 Playwright 原生报告，不把进程存在当作场景已就绪。JSON 记录场景、源码提交、dirty 状态、面板构建身份、服务 URL/实例、临时项目、服务所在 worker 的 PID/PGID、启动和到期时间，以及候选源码证据范围。

查询时读取记录并核对进程组（PID 是服务所在 worker，PGID 是 `setsid` 创建的组）：

```bash
acceptance_record="$CLAPGRID_PLAYWRIGHT_RUN_DIR/acceptance.json"
cat "$acceptance_record"
acceptance_pgid=$(jq -r .pgid "$acceptance_record")
kill -0 -- "-$acceptance_pgid"
ps -eo pid,ppid,pgid,sid,lstart,comm | awk -v group="$acceptance_pgid" 'NR == 1 || $3 == group'
```

`kill -0` 只说明组仍存在；同时核对记录的 PID、PGID、启动时间及命令，避免对旧记录中已被复用的 PGID 操作。正常停止优先向已核对的组发送 `SIGTERM`（也支持 `SIGINT`）：

```bash
kill -TERM -- "-$acceptance_pgid"
```

fixture teardown 沿用 `useProject`，关闭服务、确认媒体资源退出后删除临时项目；验收专用 preload 仅让媒体守护进程忽略组的 INT/TERM，由已有 IPC 关闭流程释放它。`acceptance.json` 不删除，停止后原子追加 `stop.reason`（`signal` / `expired`）、信号、停止时间及 `cleanup.projectRemoved` / `cleanup.serviceClosed`。两项均为 true 才表示清理成功；到期停止正常通过，SIGINT 可能由 Playwright 以 interrupted 报告。保留本轮日志并再次核对进程组已退出；父启动进程退出不等于整组已经清理。

`SIGKILL`、终端会话被强制销毁或其他异常终止不能运行 teardown。没有完整 stop 记录或清理结果为 false 时保留现场，不自动处理旧轮次。手动恢复时：

1. 从该轮 JSON、launcher.pid 和日志取精确 PID/PGID、临时项目路径及时间；用上述 `ps` 命令确认原进程组。若身份不符或无法确认，停止操作，保留现场。
2. 原组仍在则先 `kill -TERM -- "-$acceptance_pgid"`，核对后仍有残留才对同组发 `SIGKILL`；不按进程名扫描或终止其他工作树资源。确认本轮媒体命令及守护进程均已退出。
3. 确认端口关闭、资源释放，并核对 `projectDirectory` 确为该轮新建临时项目后，才手动 `rm -r -- <该轮精确临时项目路径>`。不能据此删除用户工作空间或 `clapgrid/`。其他保留目录仅在本轮日志能证明归属且资源已释放时按精确路径处理，不按通配符扫除。
4. 记录异常、人工处理结果及原报告，换新运行目录重开；不伪造旧轮的正常停止或补写为验收通过。

实际浏览器能力探测和候选源码证据边界见[检查与验收](verification.md#持续交互验收入口)。
