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

## 旧工具退出

`agent-tools.mjs` 及其专属测试、夹具已退出，不保留兼容命令或自定义日志格式。历史研究与验证记录保留当时结论；其中旧命令不再是执行入口。其他检查、产品工具与资源 helper 继续使用现有实现。
