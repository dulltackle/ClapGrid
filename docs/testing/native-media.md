# 配音、素材和成片的原生保障承接（#197）

本批 Playwright 场景直接使用 `.spec.ts` 收集、原生 browser/context/page、locator、expect、键盘鼠标和失败截图/trace。真实产品服务拥有 HTTP、SQLite、配音任务、媒体文件及导出；只在供应商边界控制返回和必要 HTTP 故障窗口，不再使用字符串 React 脚本、输入桥接、Chrome/CDP 生命周期或页面结果协议。

`tests/helpers/project.ts` 的两个具体原生选项：`speechRuntime` 传入产品服务并在重启时保留，默认沿用本机配置；`panelBuildIdentity` 只用于标准 Vite 构建的 define，默认沿用配置（供 #196 使用）。`media-project.ts` 为本例生成真实 MP3、MP4，供应商返回包含此 MP3 的标准 SSE。项目服务关闭后才删除依赖的输入目录；不引入服务池或通用资源协议。

## 故障承接

| 旧独立故障 | 当前承接 |
| --- | --- |
| 声音设置原生音色/151个语速、键盘提交、保存失败保留旧值、提交中禁止关闭、窄矮可达 | speech.spec 的声音设置 1600/420 参数测试；真实 HTTP 保存，500及真实响应gate建立失败/等待窗口 |
| 读取声音期间入口禁用、未配置凭据说明、外部修改权动态禁用但可退出 | speech.spec 的加载/占用、未配置专例；加载时所有初始 speech 查询被同一具体 gate 延迟，避免 StrictMode 第二查询绕过首请求 |
| 配音输入快照、有效配音、待更新、最新失败/未知不隐藏旧有效音频、完整新到旧历史 | speech.spec 的有效音频/失败、未知结果、历史与实时文案变更；最新历史输入快照精确比较全文 textContent（含换行与尾部标记），420×360 下检查详情 scrollWidth 不超过 clientWidth；speech.test、speech-retention.test 原有原生逻辑继续保留 |
| 配音未知提交同 requestId 重试，不重复计费；重复生成入口禁用 | speech.spec 的未知提交复用及生成中重复入口场景；实际提交先受理后网络 abort，再检查供应商调用只发生一次 |
| 实际音频解码/播放、暂停/恢复、历史播放停止表格试听、原生音量键、Tab隔离、窄矮关闭 | speech.spec 的真实MP3 controls场景，1600×1000和360×320；播放器状态和音量来自真实HTMLAudioElement，只读evaluate，不调用play替代输入 |
| 音频保留上限删除正在试听的旧项时停止/移除播放器 | speech.spec 的保留上限场景，经真实四次配音及产品保留清理，浏览器检查旧播放器移除 |
| 批量进度、配音锁、局部失败仍继续、未匹配片段错误/请求标识可访问 | speech.spec 批量场景由真实供应商pending→部分失败及产品批量队列推动；speech-batch.test、speech-service.test 保留范围、去重、持久化等独立保障 |
| 视频绝对路径导入、关联/解除、播放起点、PNG缩略图、真实WebM预览 | video.spec 的真实视频导入预览 1600/420及关联失败/解除场景；真实FFmpeg导入/ffprobe元数据和浏览器解码均实际执行。图片保障对应现有PNG缩略图，未虚构产品没有的独立图片导入入口 |
| 原生视频controls播放暂停、Tab/Shift+Tab双向范围、关闭回稳定片段 | video.spec 的预览旅程，1600×1000与420×360均从关闭入口按Shift+Tab反向遍历，再用Tab正向返回，每次确认焦点仍在真实模态。浏览器原生controls可能先消费Escape，因此将焦点移到可见关闭按钮后使用Escape；不把原生controls内部消费按键当成产品关闭失败 |
| 嵌套父入口hidden/disabled/detached后的父容器后备及连续返回 | video.spec 三参数案例，仅通过DOM建立候选不可用条件，打开/关闭/后续方向键仍用原生键盘；真实AG Grid和Radix保持 |
| 关联失败关闭子层、释放修改权、不重试、保留父来源；取消后再回父容器也不复活迟到修改权 | video.spec 的关联失败与等待申请取消案例；先等真实NDJSON响应首部，再检查lease释放及父来源 |
| 关联保存中取消，迟到成功仍保留真实已提交数据，不抢新查找 | video.spec 的真实JSON响应gate，取消不冒充撤回事务；响应送达后再核对新焦点和无子层复活 |
| 导入明确失败、已提交导入取消后旧响应不释放新设置租约 | video.spec 的导入失败/迟到案例，真实缺失文件及真实FFmpeg导入后延迟响应；新设置仍可编辑且服务owner为user |
| 失败待恢复帧不穿透新音频模态、父来源仍在；离面板期间断连关闭子层不重放返回 | video.spec 两个原生clock场景；真实键盘打开新模态；合成blur/focus只声明生命周期接线，真实服务重启负责长连接断开 |
| 预览中目标删除后先回父详情、空表最终走页面后备 | video.spec 的实际HTTP删除场景，等待父层数据同步后关闭子层和父层 |
| 导出设置只读不占修改权、保存复用租约、三个原生select、字号草稿与1–1080/null边界 | export-settings.spec 的自动保存/字号案例；export-settings.test、export-service.test 保留真实快照冲突、环境/字体缺失、持久化与任务锁 |
| 保存失败保留旧设置、保存中禁止操作/关闭、断线取消未提交字号 | export-settings.spec 的500+真实保存响应gate；先在线正常关闭并核对回更多，再重开填写草稿，真实停止服务直到公开取消错误/连接失败与旧模态卸载均可见后同端口重启，检查新实例只读/空草稿、真实已保存值及修改权为空，不伪造租约 |
| 媒体字体加载错误、已选不可用字体仍显示、窄矮表单可达 | export-settings.spec 两例，HTTP只建立环境不可用的表现条件；真实字体变化的产品行为由export-settings.test覆盖 |
| 全片导出不被勾选/查找缩小；提交/连接/取消错误彼此独立，跨详情关闭与重连仍保留 | export.spec 全片范围/错误及取消错误场景，实际HTTP拒绝和真实校验失败任务覆盖第二个未匹配片段；UI取消交互仅固定真实任务的展示状态以建立可控窗口，真实取消与清理由既有服务测试和#198覆盖 |
| 导出进度、取消中按钮禁用及可用后备、重试成功清旧错误 | export.spec 取消场景通过原生progress、HTTP gate与框架焦点检查；不声称受控rendering展示等于真实渲染运行 |
| 实际成片与兼容预览链接、MP4文件、任务到诊断键盘链和版本/项目身份字段 | export.spec 真实制作路径，经真实配音、视频、导出设置和FFmpeg产生成功任务；检查产品链接及实际读取MP4，诊断关闭回捕获来源 |

## 保留与删除的边界

保留 speech、speech-provider、speech-retention、speech-batch、speech-service、speech-config、video、video-service、export-settings、export-tasks、export-service 原生 Vitest 测试，不为已经有效的产品逻辑重建浏览器矩阵。它们继续实际执行必要 SQLite、HTTP、MCP、FFmpeg/ffprobe 与 Node 子进程。删除的 `speech-provider.native.ts` 只是同源 node:test 重复对照，不是产品旧格式兼容样本。

旧 voice/audio/media/video/video-preview/export-settings/export/more-tasks 的 panel 字符串文件由上表承接并删除。#196 删除旧 dialog-panel 时，其中媒体controls、异步导入和嵌套来源的后果由本批实际场景承接。共享旧 helper 已在最后消费者退出后由 #200 删除。

## 配音期间导出入口的真实契约

旧 export-panel 字符串替身曾将 `status.taskLocked` 与 `exports.locked` 一起模拟，并声称配音期间导出按钮应禁用。当前产品 `src/panel/app.tsx` 两个“导出全片”入口的实际禁用条件是项目/连接不可用、导出提交忙碌或导出任务锁；没有把配音锁加入按钮条件。配音锁同时受 `disabled` 保护，禁止新增/生成等修改，但允许用户点击导出并由真实服务拒绝。

本批批量配音case实际查询 `querySpeech().locked` 和真实批量进度，确认新增禁用，再点击导出并等待本次POST响应，精确检查HTTP 400、服务错误“配音任务尚未结束，不能开始导出；允许查询和试听”、操作错误区域及导出任务列表仍为空；不将按钮放行当作导出受理。配音任务锁对导出无任务/无媒体进程的结果由保留的 speech/export 逻辑及 #198 七拒绝窗口和真实FFmpeg正向专项承接。这里记录现有契约差异，不修改产品，也不以较弱断言替代导出拒绝保障。

以上为源码测试承接，安装包和实际宿主没有随测试变更更新。性能按用户确认前后各1轮报告；开发定向迭代和npm ci不是性能样本。

真实断线与在线关闭是不同的生命周期：App 在状态查询失败时清空 status 并卸载设置模态，重连后重新挂载，其本地消息恢复为“设置按项目自动保存”，不持久保留旧实例的取消消息。测试在真实离线窗口检查公开取消反馈，重连后检查草稿丢弃、只读、持久化值、修改权释放与可关闭。旧字符串例只断开编辑 lease，状态查询仍正常，没有保护真实 HTTP 离线后的卸载/重挂载组合。

本轮另观察到既存产品缺口：真实断线卸载时 onCloseAutoFocus 会消费一次性来源，重连后的设置实例复用该来源，最终关闭不能保证再次回到“更多”。在线正常关闭的返回保障继续单独检查；本轮只修测试迁移，不改产品，也不宣称已修复或覆盖该组合焦点缺口。原生失败 trace、实际 activeElement 和复现源码在本轮仓库外诊断记录保留。
