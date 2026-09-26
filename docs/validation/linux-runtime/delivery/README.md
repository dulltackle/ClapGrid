# Ubuntu 原型安装入口交付

对应 #13，2026-09-26；承接上一轮只验证 APT 命令、未交付安装入口的缺口。本目录是原型的安装层，真实配音／导出组件不在范围内。原型服务与页面仍来自固定归档，没有修改其实现。

## 交付内容

- `runtime-linux.sh`：check、install、start、status。仅显式 install 可以安装软件；安装结束不启动服务或任务。
- `runtime_status.py`：独立、只读查询 `/state`，核对服务身份和项目；不会偷偷重启。
- `SKILL.md`：由 Codex 完成检查、首次安装、复用／启动和右侧打开；把宿主审批拒绝与系统管理员权限不足分开反馈。
- `plugin.json`：由 plugin-creator 的 cachebuster 工具生成版本 `0.1.0+codex.20260926075948`。
- `build_plugin.py`：校验归档 ZIP SHA256，然后添加上述入口和技能，输出可分发插件目录及 ZIP。

Ubuntu 24.04 的依赖方案是系统仓库 `python3` 及其依赖，不使用 pip，也不要求用户安装 Docker。已有 Python 3.9 以上可直接运行。其他发行版仅支持已有 Python 路径，自动安装返回 11；Windows/macOS 的首次安装由 #11/#12 继续验证。宿主安装需要管理员权限，原型没有提供通用图形认证代理；没有 root 或可用的非交互 sudo 授权时，返回 12，等待用户通过允许的认证流程处理。

## 构建与分发

以下由发布者执行，需要 Git 和 Python；**不是缺少 Python 的最终用户安装步骤**。先获取固定归档提交（本仓库已存在该对象），再构建到全新的输出目录：

```bash
git fetch origin af22343add8bf9c0b779fc6e8e681ff7c3b069fe
python3 docs/validation/linux-runtime/delivery/build_plugin.py /tmp/clapgrid-delivery-release
python3 -m zipfile -t /tmp/clapgrid-delivery-release/clapgrid-runtime-probe.zip
```

输出 `clapgrid-runtime-probe/` 可作为本地市场插件源，ZIP 可供分发。现有安装应先用 `codex plugin list --json` 核对实际源路径，在确认对应关系后更新源文件，再运行 `codex plugin add clapgrid-runtime-probe@personal --json`。不直接改安装缓存，也不手改市场配置。更换源内容时使用 plugin-creator 的 cachebuster 更新流程。本次从实际源 `/home/forclaw/plugins/clapgrid-runtime-probe` 重装成功，安装缓存位于 `/home/forclaw/.codex/plugins/cache/personal/clapgrid-runtime-probe/0.1.0+codex.20260926075948`。

本机另有 `.agents/plugins/plugins/` 同名副本；第一次重装仍返回旧版，通过 CLI 查明实际源后已恢复未使用副本、更新真实源并重装。不能仅凭重装命令返回成功就宣布新代码已安装。[缓存哈希](../delivery-evidence/cache-sha256.json) 验证四个新文件与仓库内容一致，[已安装插件信息](../delivery-evidence/installed-plugin.json) 记录实际来源及版本。

更新后的技能需要在新聊天调用 `$clapgrid-runtime-probe`，才能验收新版本技能发现。本聊天已经从新安装缓存执行入口并验证右侧打开；没有将这一结果冒充新聊天的技能发现验证。

## 入口和错误契约

由 Codex 从安装缓存调用 `bash <脚本目录>/runtime-linux.sh <操作>`；start/status 同时传入相同 `--port` 与 `--project`。默认端口为 48761，默认项目为系统临时目录中的 `clapgrid-PROTOTYPE-wipe-me`。任何状态查询都不启动任务。

| 操作／返回码 | 含义与下一步 |
| --- | --- |
| check / 0 | 组件就绪，可查询服务 |
| check、start、status / 10 | Python 缺失或不兼容，由 Codex 说明安装内容并经宿主审批运行 install |
| install / 0 | 组件已就绪；已有组件时跳过 APT，不重新安装 |
| install / 11 | 自动安装不支持该发行版，未执行安装 |
| install / 12 | 需要系统管理员认证，未执行安装；与宿主审批拒绝不同 |
| install / 13 | APT 或安装后组件检查失败；保留具体错误，解决原因后重试 install |
| status / 20 | 没有确认目标服务在线，包含连接错误、无效响应或身份／项目不符；保留已有服务并排查 |
| 无脚本返回码 | 宿主可能在执行前拒绝工具调用。技能报告本次未执行，不伪造脚本退出码，不绕过拒绝 |

组件安装经 Ubuntu 签名仓库与 APT 完成。`APT::Update::Error-Mode=any` 保证索引获取失败时停止；包安装使用非交互前端，避免干净系统的 tzdata 提示阻塞。管理员授权和 Codex 执行审批都必须满足，脚本不会修改安全策略或获取密码。

## 实际运行结果

容器采用同一固定 Ubuntu 镜像，名称 `clapgrid-issue13-delivery-final`；初始没有 Python、没有 Codex。通过 `docker cp` 将构建的插件复制到 `/opt/clapgrid-runtime-probe`，以下操作均实际执行，没有用假 Python 或假 APT 代替。

| 场景 | 结果与证据 |
| --- | --- |
| 缺少 Python 执行 check | 返回 10，明确本次未启动服务；[输出](../delivery-evidence/missing.txt) |
| UID/GID 65534 且无 sudo 执行 install | 返回 12，请求系统管理员认证；[输出](../delivery-evidence/no-admin.txt) |
| 无网络执行 install | 返回 13，保留 DNS/APT 错误及重试说明；[输出](../delivery-evidence/offline.txt) |
| 同容器接入 bridge 后重试 install | 返回 0，Python 3.12.3；[输出](../delivery-evidence/retry.txt) |
| 再次 install | 已就绪，跳过安装；[输出](../delivery-evidence/reinstall.txt) |
| 安装后 start，另一次 docker exec 执行 status | 同一 PID 与项目；[启动](../delivery-evidence/container-start.json)、[独立查询](../delivery-evidence/container-state.json) |
| 新缓存复用上一轮宿主服务 | PID 154611，原任务已完成，未重复创建；[状态](../delivery-evidence/host-reuse.json) |
| 新缓存默认沙箱冷启动 | 启动器即时返回后，下次 status 返回 20；[启动](../delivery-evidence/host-sandbox-start.json)、[查询失败](../delivery-evidence/host-sandbox-status.txt) |
| 新缓存经宿主执行审批冷启动 | 自动审核允许，独立 status 查询 PID 199030；[状态](../delivery-evidence/host-approved-state.json) |
| 新服务运行任务时重复启动 | 10 秒模拟任务期间重复 `/start` 返回 409，重复包装启动器复用同 PID／任务；[启动任务](../delivery-evidence/host-task-start.json)、[拒绝重复任务](../delivery-evidence/host-duplicate-task.txt)、[复用](../delivery-evidence/host-task-reuse.json) |
| 查询错误项目 | 返回 20，原服务未被重建；[输出](../delivery-evidence/wrong-project.txt) |
| 新服务右侧页面 | open_in_codex 返回 queued，随后内置浏览器实际读取到“已连接 · 可编辑”、两行文案和模拟任务按钮；URL 为 `http://127.0.0.1:48765/` |

复测安装实验时可参考上一层 README 的固定镜像创建与网络切换步骤，把容器名替换为新的唯一名称，并使用本次 ZIP 内的 runtime-linux.sh：依次 check、无权限 install、断网 install、接入 bridge 后 install、再次 install、start、独立 status。原始输出仅规范终端回车和行尾空白，未移除错误或警告。记录的进程 ID 只对应本次实验，不作为复测的固定预期。

本轮 48765 的 10 秒任务完成后，通过不带中断参数的 `/stop` 正常停止测试服务，返回 200，见 [清理结果](../delivery-evidence/host-stop.txt)。两个新增测试容器已停止并保留；原有 48763 服务与项目保持不变。

## 尚未验收的边界

本轮交付了 Ubuntu 原型安装入口、明确了依赖来源，并在已安装缓存验证 Codex 启动及右侧打开。**干净容器不等于干净 Codex 桌面**：缺少 Python 的真实桌面首装及系统图形认证仍待验证。真实宿主审批拒绝尚未出现，只交付了技能中的处理分支；无 sudo 的系统权限失败不能代替它。

遵循用户要求，没有新增自动化测试。已执行 shell 语法、Python 编译、技能／插件结构验证和实际接口检查。仓库没有配置类型检查或全量测试命令；不把语法检查称为类型检查。提交前安排一次只读代码审查，并检查证据、缓存一致性及文档链接。
