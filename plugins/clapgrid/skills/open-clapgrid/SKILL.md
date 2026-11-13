---
name: open-clapgrid
description: 打开当前本地工作空间固定项目的 ClapGrid 口播片段表格；检查组件、自动连接服务并在 Codex 右侧制作视频。
---

# 打开 ClapGrid

插件根目录为本技能目录的 `../..`；先解析绝对路径。全程中文沟通。

## 制作、局部修改与审阅

开始制作、局部修改或审阅时，先读取实际宿主工作空间根目录的 `video.md`，沿用当前项目的整体观感、参考与关键做法。缺少文档时，在 ClapGrid 源码目录运行 `node scripts/production.mjs init --project <宿主工作空间绝对路径>`，从[公共模板](https://github.com/dulltackle/ClapGrid/blob/main/docs/templates/video.md)初始化独立副本；引用检查使用同一入口的 `refs` 命令。制作命令的路径参数只定位当前项目文件，项目仍按既有工作空间归属规则识别。

需要深入设计动作、比较关系或制作卡时按需读取[通用制作指南 #102](https://github.com/dulltackle/ClapGrid/issues/102)；[视觉参考 #103](https://github.com/dulltackle/ClapGrid/issues/103)供项目选用。动态样片确认范围与完整成片审阅要求以当前项目 `video.md` 为准。

批量制作前，先展示能代表本项目素材、主要动作及转场的动态样片，取得真实用户视觉方向确认，并记录样片、采用方案的内容身份、原用户来源和范围。运行统一入口的 `sample` 命令，只有 `batchAllowed: true` 才按该方案与范围批量制作；待审、否决、错误版本与受控测试保持未许可。样片与方案的内容、范围未变时显式复用确认，实质变化后重新展示受影响范围。样片确认不替代其他画面、领域判断、发音听审或完整成片终审。记录格式按需读取[样片接入说明](https://github.com/dulltackle/ClapGrid/blob/main/docs/production-sample.md)。

### 选用项目风格

选用或修改风格时，先读[内置风格](../../styles/README.md)及所选风格的 `STYLE.md`；风格头部声明 `needs` 时，复制前先按[风格](references/composition.md#风格)第 1 步检查所需能力，不满足时不制作代码替身。然后再按[画面编排制作约定](references/composition.md#风格)复制、导入、设为项目风格并在页面中引用。先写本项目方案再读示例；根据字幕模块的 `subtitleRegion` 为字幕留出画布空间。风格变化后重新取得受影响范围的动态样片确认，交付前完成六个维度的制作者自检。导出前必须设置项目风格；旧项目格式需另建项目，保留旧项目文件。

### 逐句画面素材

用户要求为指定口播片段搭配画面或添加 IP 时，默认完成素材准备、逐句编排及可审阅合成结果；明确“先准备素材”才在导入与确认归属后停止。沿用已确认的视觉方向和范围；每句只加入对应素材，不擅自应用全片，不要求用户操作剪辑器。编排规则、页面运行约定、导入边界和自检流程见[画面编排制作约定](references/composition.md)。

1. 查询当前片段快照，导入素材并确认本句归属。
2. 准备有效配音，调用 `clapgrid_visual_context` 取得精确时长与输入，核对最新片段快照后提交编排；不默认均分、贯穿整句或跨句套用。
3. 需要动画背景、镜头推拉或透明标注时，编写并导入页面，以页面图层提交；修改页面后重新导入并提交新身份。交付前对页面图层做制作者自检。
4. 生成片段合成预览并查询终态，只有 `succeeded` 且 `current: true` 才提供本句可播放的合成结果。失败报告原因，未知结果先查询，不自动重发写操作。
5. 用户通过对话要求修改时，重读该句输入、提交新编排并重新生成预览，保留无关片段和项目原件。全片导出读取同一已保存编排。

## 日常快速重开

用户明确要求迁入旧项目时，先走下方完整流程的迁入步骤。其他打开请求首先调用实际宿主的 `clapgrid_prepare_panel`，无需先执行 shell 检查或读取 Linux 准备流程。

- `state: ready`：工具已核对当前聊天、工作空间、项目、服务实例和已加载插件版本。直接用返回的完整 `url` 调用 `open_in_codex`（`placement: right`，`target.type: browser`），保留 `/binding/…` 路径。实际读到表格或用户确认后，简短报告已打开。日常重开到此结束，无需重复组件检查、`workspace-status`、`clapgrid_status`。
- `state: needs-start`：只有此结果表示明确离线；使用返回的 workspace/thread 进入下方完整流程。
- 工具错误：按具体原因处理过期插件、版本不一致或身份异常，停止快速路径；不以异常为由自动启动或更换服务。
- 工具未加载：重载插件；组件缺失导致 MCP 无法加载时读取 Linux 准备流程。不得用命令行模拟 MCP 成功。

仅在插件更新交付、用户要求诊断或面板显示版本/连接异常时，执行完整版本核对。快速重开不替代仓库 `docs/agents/plugin-delivery.md` 的更新验收。

## 首次打开或明确离线

1. 从当前宿主上下文取得本地工作空间根目录和当前聊天 ID（本地执行环境的 `CODEX_THREAD_ID`）。没有本地工作空间时提示先选择或创建工作空间，停止打开；不使用插件目录、临时目录或上次项目。不可让用户另选 ClapGrid 项目目录或端口。
2. 用户明确要求从旧项目迁入时，在首次 open 前读取并完成[显式迁入流程](references/import.md)，取得成功结果后继续日常打开；目标已存在时遵循拒绝结果。
3. Linux 读取 [组件准备流程](references/linux.md)，完成 check。其他系统检查 Node.js 至少 22.13 及 FFmpeg/ffprobe。宿主必须能运行 `codex app-server --stdio` 并读取本聊天；不能核对时停止。Linux 下本文所有 `node <插件根目录>/dist/runtime.js <操作>` 均使用 `bash <插件根目录>/scripts/runtime-linux.sh <操作>`。
4. 经宿主执行审批运行 `node <插件根目录>/dist/runtime.js open --workspace <宿主工作空间绝对路径> --thread <当前聊天ID>`。它会核对宿主当前目录，在固定 `clapgrid/` 子目录创建或恢复项目，并自动发现或启动服务；服务端口无需配置。审批拒绝时报告拒绝原因并停止，不更换路径绕过拒绝。启动未确认时检查日志，不自动重复启动。若提示插件过期，先重载宿主插件；若提示服务版本不一致，执行项目仓库的插件更新流程，保留运行任务，不把旧服务在线当作新版已打开。
5. 在独立调用中执行 `workspace-status`，使用相同 workspace/thread 参数。只有它返回成功才声明在线；核对返回的 workspace、snapshot.project.directory、项目 ID 和 instanceId。数据库、素材、配音及成片保存在该工作空间的 `clapgrid/` 中。
6. 使用 `open_in_codex`，`placement: right`、`target.type: browser`，URL 为刚核对的完整 `url`（保留 `/binding/…` 路径）。返回 queued 时继续检查内置浏览器；只有实际读到表格或用户确认看到才算打开成功。
7. 调用实际加载的 `clapgrid_status`，核对它的项目 ID、项目目录及 instanceId 与面板一致，同时比较 `clapgrid_host_context.buildIdentity`、状态的 `buildIdentity` 和实际页面中 `window.__clapgridBuildIdentity` 的版本指纹。版本缺失或不一致时报告未验证／需更新，不宣称已更新可用。业务 MCP 自动读取请求中的宿主聊天身份并发现当前工作空间服务；不得配置 `CLAPGRID_SERVICE_URL`。工具未加载时说明需重载插件，不能以命令行协议测试代替实际宿主验证。

打开不发起配音、导出或片段写入。关闭面板或 MCP 不终止已受理任务；重开先查询，不重发制作请求。宿主工作空间改变后，关闭旧面板并重新执行打开流程；旧项目后台任务继续，旧面板业务请求会因工作空间不符而拒绝。身份无法核对、地址复用或断线时停止操作，不自动重试制作。

用户要求退出服务时执行 `workspace-stop`，使用当前 workspace/thread 参数。有任务返回 `kept`，保持服务；仅用户明确选择“中断任务并退出”后加 `--interrupt`。`stopping` 仅表示已受理，继续查询至旧实例离线。普通 SIGTERM/SIGINT 也默认保持任务，不强制终止。恢复中断任务遵循现有清理与锁规则，不删除锁文件或媒体运行标记。

诊断宿主关联时可调用 `clapgrid_host_context`；roots 不支持不等于没有本地工作空间，进程目录也不是工作空间。旧位置项目仅按显式迁入流程复制，不以 `--project` 作为日常切换入口。
