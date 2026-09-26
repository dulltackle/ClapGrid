# Linux 首次组件安装与宿主启动验证

对应 [#13](https://github.com/dulltackle/ClapGrid/issues/13)，2026-09-26。本轮按用户要求只做实际运行验证，不新增自动化测试，不修改原型代码。**事项尚未全部验收，不关闭。**

## 环境与证据边界

| 环境 | 版本 | 用途 |
| --- | --- | --- |
| 桌面宿主 | Ubuntu 24.04.5 LTS / x86_64；chatgpt 包 26.924.20706；Codex CLI 0.158.0-alpha.2；已有 Python 3.12.3 | 沙箱与宿主启动、右侧表格、服务和任务复用 |
| 干净容器 | Ubuntu 24.04.5 LTS / x86_64；初始没有 Python、没有 Codex | 真实缺组件、断网安装失败、恢复网络重试、安装后启动 |
| 插件 | 已安装的 clapgrid-runtime-probe 0.1.0 | 宿主从缓存脚本启动，没有重装插件 |

容器不是干净桌面实机：没有安装 Codex，不能把两组结果拼接为“干净 Linux 桌面首次安装全流程通过”。Docker 29.8.1 仅用于验证，不是用户运行依赖。镜像固定为 `ubuntu@sha256:008173c23f95b170204355c12626cb5a965d779a7e1283b09e9cffbb1bf33ca3`。

原型仍保留在独立归档分支，没有复制到主分支。归档提交为 `af22343add8bf9c0b779fc6e8e681ff7c3b069fe`，目录为 `prototypes/runtime-lifecycle`。ZIP SHA256 为 `79d89ee26aca59032c59644ab10c75e4269e2e45d14e57c4963778c92dd77278`；宿主缓存 `prototype.py` 的 SHA256 为 `8a89598bc5a267d2071138bf08de3722a6eebc587ada03ebc5237cdc5330d1c2`，与归档一致。

## 组件与分发

当前模拟原型使用 Python 3.9 以上的标准库（使用 `str.removeprefix`），本轮实际版本为 3.12.3。Ubuntu 24.04 的组件来源为系统配置的 Ubuntu APT 仓库，安装 `python3` 及其依赖；不需要 pip、Node 或 FFmpeg。页面与合成媒体随归档插件 ZIP 分发。真实配音、导出及 Windows/macOS 的最终组件方案仍未确定，不能由这次 Python 模拟原型推导完成。

首次安装由 Codex 检查 Python，缺失时解释所需安装内容，并通过宿主批准的执行方式安装。APT 需要系统管理员权限；本轮仅在专用容器内以 root 安装，没有改动宿主包。普通桌面用户如需 sudo/系统认证，必须使用宿主允许的审批和认证流程，不能读取或代填密码，不能悄悄改用其他提权路径。已安装插件 0.1.0 的技能仍只会在缺少 Python 时请求用户安装；**本轮验证了安装命令方案，没有交付自动安装器或更新该技能。**

日常操作由 Codex 从安装缓存运行 Python 启动器，并用宿主 `open_in_codex` 的 right/browser 打开返回的本机 URL。用户无需手动打开终端。该流程在已有组件的当前宿主已运行；首次安装的插件一体化入口仍需后续实现与验收。

## 可复现的安装实验

以下命令由验证者或 Codex 执行。容器名必须空闲；不要删除同名未知容器。

```bash
docker run -d --name clapgrid-issue13-clean --network none \
  ubuntu@sha256:008173c23f95b170204355c12626cb5a965d779a7e1283b09e9cffbb1bf33ca3 sleep infinity
docker exec clapgrid-issue13-clean bash -c 'cat /etc/os-release; uname -m; command -v python3'
docker exec clapgrid-issue13-clean bash -c \
  'apt-get update -o APT::Update::Error-Mode=any -o Acquire::Retries=0 -o Acquire::http::Timeout=5 && apt-get install -y --no-install-recommends python3'
```

缺失检查没有找到 Python。安装实际返回 100，日志见 [install-offline.txt](install-offline.txt)。`Error-Mode=any` 使索引获取失败返回非零，避免旧索引掩盖失败；`&&` 保证索引失败后不继续安装。此次会话向用户反馈“首次安装未完成，服务未启动”，不是产品内的失败提示验证。

恢复网络时，必须先断开 `none`；直接添加 bridge 曾被 Docker 拒绝，属于实验网络配置错误，不是组件安装错误。

```bash
docker network disconnect none clapgrid-issue13-clean
docker network connect bridge clapgrid-issue13-clean
docker exec clapgrid-issue13-clean bash -c \
  'apt-get update -o APT::Update::Error-Mode=any -o Acquire::Retries=0 -o Acquire::http::Timeout=15 && apt-get install -y --no-install-recommends python3 && python3 --version'
```

在同一容器重试返回 0，得到 Python 3.12.3；完整输出见 [install-retry.txt](install-retry.txt)（仅将终端回车规范为换行并去除行尾空白，未删减错误或警告）。非交互容器存在 debconf 前端警告，APT 最终安装成功。

从仓库提取固定 ZIP 并在已有 Python 的宿主解包（这些是实验准备命令，不是无 Python 桌面的安装器）：

```bash
git show af22343add8bf9c0b779fc6e8e681ff7c3b069fe:prototypes/runtime-lifecycle/clapgrid-runtime-probe.zip > /tmp/clapgrid-issue13-probe.zip
sha256sum /tmp/clapgrid-issue13-probe.zip
python3 -m zipfile -e /tmp/clapgrid-issue13-probe.zip /tmp/clapgrid-issue13-assets
docker cp /tmp/clapgrid-issue13-assets/clapgrid-runtime-probe clapgrid-issue13-clean:/opt/clapgrid-runtime-probe
docker exec clapgrid-issue13-clean python3 /opt/clapgrid-runtime-probe/scripts/prototype.py --project /tmp/clapgrid-issue13-container
docker exec clapgrid-issue13-clean python3 -c 'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:48761/state").read().decode())'
```

后一个命令须独立执行。两次状态中的 PID、项目相同，见 [container-start.json](container-start.json) 和 [container-state.json](container-state.json)。这只证明容器服务跨 docker exec 存活。

## 桌面宿主实测

为避开旧原型使用的 48761，本轮使用端口 48763、专用临时项目 `/tmp/clapgrid-issue13-host`。缓存路径来自已安装插件：

```bash
python3 /home/forclaw/.codex/plugins/cache/personal/clapgrid-runtime-probe/0.1.0/scripts/prototype.py --port 48763 --project /tmp/clapgrid-issue13-host
```

1. 默认沙箱调用返回 PID 3、无任务，时间 `1790408225.3789368`；下一次独立 `curl --noproxy '*' --max-time 2 -sS http://127.0.0.1:48763/state` 返回 7，连接失败。没有把启动器的即时输出当作持久服务成功。
2. 同一命令通过 `require_escalated` 提交宿主执行审批，自动审批允许，返回 PID 154611、时间 `1790408249.8731472`。随后独立 `/state` 可达，见 [host-state-independent.json](host-state-independent.json)。没有修改权限、安全设置或审批策略。
3. 重复启动器复用 PID 154611，见 [host-reuse.json](host-reuse.json)。右侧打开工具返回 queued 后，另用 Codex 内置浏览器读取实际页面，确认标题“ClapGrid 运行验证原型”、“已连接 · 可编辑”、两行文案及任务按钮；不是只凭 queued 判通过。本轮不是新插件安装验收。
4. 通过 `/start` 启动 900 秒的无费用模拟任务；重复请求返回 HTTP 409，“已有后台任务，未重复创建”。再次运行启动器仍为原 PID 和同一任务。见 [host-task-start.json](host-task-start.json)、[host-duplicate-task.txt](host-duplicate-task.txt)、[host-task-reuse.json](host-task-reuse.json)。

对应 API 命令如下。先读状态；如有运行任务，保留该任务，只做重复请求验证，不创建新任务。

```bash
curl --noproxy '*' --fail --max-time 3 -sS http://127.0.0.1:48763/state
curl --noproxy '*' --max-time 3 -sS -w '\nHTTP %{http_code}\n' \
  -H 'Content-Type: application/json' -d '{"seconds":900}' http://127.0.0.1:48763/start
```

第一次无任务时请求返回 200，随后在任务运行中重复同一请求返回 409。再运行上述缓存启动器并核对返回的 PID 和任务 ID 不变。模拟任务仅计时，不调用收费服务。

宿主审批拒绝尚未发生，不能用模拟错误替代真实拒绝验收。预期交付反馈应为“宿主未允许启动，服务未启动；允许后可重试”，随后先核对 `/state`，避免将本来在线的旧服务误报为停止；不能绕过拒绝重试另一种执行方式。该反馈目前是流程要求，不是已实现或已验证的拒绝分支。

## 完全退出后的接续

本轮已经保存任务启动基线及 [退出前状态](host-before-exit.json)，实际宿主版本输出见 [host-environment.txt](host-environment.txt)。**真正退出前须再次读取并保存即时状态，确认任务仍“运行中”且留有充分时间**；900 秒任务可能在等待期间完成。若已完成，应明确开始新的无费用模拟任务并记录新的任务 ID 和即时基线，再退出，不能把退出前就已完成的任务用于验收后台任务继续。

用户完全退出 Codex 后重开本聊天，**先请求** `http://127.0.0.1:48763/state` 并保存原始结果，再决定是否重新启动。核对 PID 与退出前基线一致（本轮为 154611）、任务 ID 与即时基线一致、进度增长或已完成，并记录实际退出和重开时间。若不可连接，保留失败，不重启后伪称旧服务存活。临时项目仅用于验证，不代表生产项目的持久存储方案。

当前仍待用户退出重开；#10 的旧版本历史证据单独保留，不能冒充本轮结果。后台服务为这一步暂时保留；容器实验结束后已执行停止并保留专用容器，宿主服务需在任务完成后调用 `/stop` 正常退出。

```bash
# 重开后首先保存状态，不能先运行启动器。
curl --noproxy '*' --fail --max-time 3 -sS http://127.0.0.1:48763/state > /tmp/clapgrid-issue13-after-exit.json
# 完成全部检查且任务已结束后，正常退出本次验证服务。
curl --noproxy '*' --max-time 3 -sS -w '\nHTTP %{http_code}\n' \
  -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:48763/stop
```

`/stop` 在有运行任务时返回 409 并保持运行；不发送 `interrupt:true`。若响应仍是运行中，应保留服务直到任务完成。

## 验收状态

| #13 原验收项 | 本轮状态 |
| --- | --- |
| 干净 Linux 的版本、缺组件、首次安装、失败与重试 | 部分完成：干净容器通过；干净 Codex 桌面端一体化首次安装未验证 |
| 安装与分发方式、Codex 日常启动与右侧打开 | 部分完成：明确 Ubuntu 模拟原型方案，已有组件宿主通过；最终组件方案及插件首次安装入口未交付 |
| 宿主审批允许及拒绝反馈 | 部分完成：允许启动与跨调用通过；真实拒绝未验证 |
| 独立 state、退出后继续、服务与任务复用 | 部分完成：跨命令与复用通过；本轮退出重开待实测 |
| 可复现步骤、实际版本和运行交付说明 | 已补齐本轮步骤、版本、原始证据及限制 |

未新增自动化测试；仓库没有类型检查或全量测试配置，本轮无生产代码变更。提交前检查证据 JSON、归档 ZIP/缓存脚本校验值、文档引用和 Git 空白错误，并进行只读审查。
