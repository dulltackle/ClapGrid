# 配音、素材与导出面板原生执行（#167）

八个文件、32 个原场景由唯一清单改为 Playwright 执行：audio-panel、export-panel、export-settings-panel、media-panel、video-panel、video-preview-panel、visual-note-panel、voice-panel。每个旧场景名称、文件、位置和新执行者见 [逐场景映射](scenario-map.json)。八文件的原 `String.raw` 业务脚本逐字不变，原断言、键鼠请求和等待保留；增加的工具回归不替代任何旧场景。缺失浏览器不能跳过，原 30/40 秒用例时限与零重试保留；严格 UI、零收集及不完整报告仍由公开 runner 拒绝。

## 资源与隔离

`Panel.check(script, fixture, width, height, options)` 接受每例 `resources` 字节资源与 `reducedMotion`。真实 HTTP 服务仍在每例监听随机本机端口，页面和资源同源；保留媒体 Range/Content-Range、类型与长度响应。没有把真实视频边界改成 route mock。video-preview 的四个视口仍各自用真实 ffmpeg 生成八秒 H264 和缩略图，实际播放、暂停、定位及恢复；420px 视口继续核对减少动态效果偏好。

Chrome 进程按原生 worker 复用，每例另建 context/page、storage 和目录，需要 HTTP 资源的用例另起独立服务；不复用前例服务状态或媒体字节。只复用已有的源码/配置指纹编译缓存，命中仍执行页面与本次报告。音频 Blob 与业务 HTTP 客户端替身保持各旧场景边界。导出设置原 dump-dom 场景保留 1600×1200 窗口设置，改为等待实际结果；其余视口均沿用原值，生产同源 Vite/Tailwind 样式和真实 CDP 输入保持。

正常与失败收尾先关闭 context，再 `closeAllConnections` 并等待 HTTP `server.close` 回调，最后进入目录回收和计时记录的最终 finally。各项清理错误累计为 AggregateError 并保留，也不因前一步失败跳过后续清理。拥有权 marker 校验失败继续报告失败。ffmpeg 生成目录放入本次登记资源根的独立 `media-*` 子目录，正常 finally 删除；worker 强杀时由原拥有者等待进程退出后统一回收，避免依赖 worker 的 finally。

## 实际验证与边界

公开 Playwright 入口的原八文件 32/32 通过，零 skip/todo/retry；该来源早于资源清理修补。审查发现 context/server 关闭异常可能跳过目录回收，已改为累计异常及最终 finally；同时将原临时 ffmpeg 目录移入拥有权根。修补后真实视频四视口 4/4、工具生命周期 4/4 与 typecheck 通过，不把它们称为当前提交完整验收。

增强的原 worker 复用例继续验证 DOM/storage/context/page/目录隔离，并真实请求两个不同 HTTP 资源；成功和失败后实际连接端口须返回 ECONNREFUSED，不能只依赖 server-stop 日志。原 CPU 阻塞 worker 取消例完整保留；新增活动媒体 HTTP 页面取消例另核对 worker/Chrome 退出、端口不可达、登记根内生成媒体与目录消失、锁释放。失败/超时待办和集中复验原断言保留，仍属于 all/tooling。开发原报告、source identity、原生 JSON、日志、宿主原 session 收尾及副本由协调者 run.json 的 media-167 证据索引保存。

## 三次测量与局限

同机 Linux、Node 22.23.3、文件并发 1，`NODE_DISABLE_COMPILE_CACHE=1` 且 `CLAPGRID_BROWSER_BUILD_CACHE=0`，协调所有其他检查静默后，通过公开 test-runner 运行原视频预览四视口三次，均 4/4 实际通过。耗时 19.358、19.201、19.297 秒，中位数 19.297 秒；原日志 SHA256、命令和条件见 [测量索引](measurements.json)。

用户明确续时60分钟后，在原候选af62a49完成同机、同覆盖、单worker的三次后测：20.647 / 19.525 / 19.359秒，中位19.525秒，比旧19.297秒增加1.18%，本代表组没有改善。候选实际bundle/styles缓存关闭且0命中；基线只有禁缓存环境及当时源码证据，没有逐例timings，不能补写观测。候选报告输出移至外部保全目录，输出I/O路径与基线不同，OS页缓存未控制；约1%的差异不视为稳定结论。每轮四个真实视频视口完整passed、retry0，12个实际HTTP端口及浏览器/目录均收尾。原件及局限见[汇总及保全索引](../check-161/README.md)。最终固定候选全量验收及CI另以对应提交的正式报告为准，不以局部测量替代。
