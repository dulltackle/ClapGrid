# Ubuntu 右侧预览音频听感验证

对应 [#14](https://github.com/dulltackle/ClapGrid/issues/14)。2026-09-26 本轮结果：通过。用户已确认右侧预览的播放、暂停、继续及拖动后播放流程正常；听音路径为远程桌面音频，本地扬声器音量 70%。结论仅覆盖本次 Ubuntu 宿主及该听音路径，不代替 Windows/macOS 独立验收。

## 环境与操作

- 系统：Ubuntu 24.04.5 LTS（读取 `/etc/os-release`）。
- Codex 安装包：`chatgpt 26.924.20706`（`dpkg-query -W chatgpt`；未独立核实正在运行的应用是否已重启至该版本）。
- Python：3.12.3；插件缓存版本：`0.1.0+codex.20260926075948`。
- 从已安装插件执行 `runtime-linux.sh check` 和 `status`；复用 `http://127.0.0.1:48761`，返回 PID 214695、项目 `/tmp/clapgrid-PROTOTYPE-wipe-me`、无任务且未锁定。未启动新服务或模拟任务。
- `open_in_codex` 返回 queued，随后通过 Codex 内置浏览器创建可见页，实际读取到「ClapGrid · 运行验证原型」「已连接 · 可编辑」和「测试媒体」。
- `wpctl status` 默认输出：Family 17h/19h HD Audio Controller 模拟立体声；`wpctl get-volume @DEFAULT_AUDIO_SINK@` 返回 `Volume: 0.34`，未显示静音标记。用户确认实际通过远程桌面音频在本地扬声器听音，本地扬声器音量 70%；这与 Ubuntu 宿主的 34% 是两个独立音量层级。反馈后再次查询宿主音量，仍为 34%。
- 页面首次观察显示媒体缓冲；只读媒体状态为 `muted=false`、`paused=true`、`readyState=0`，尚无有效时长；该初始状态不构成播放失败结论。用户试听后只读复查显示 `muted=false`、`paused=true`、`readyState=4`、时长 4.025 秒；画面中的扬声器图标未显示静音。播放器数值音量未从工具返回值取得，用户也未报告，故不填写推测数值；已记录播放器未静音状态。

## 媒体检查

在线 `/preview.webm` 与固定提交 `af22343add8bf9c0b779fc6e8e681ff7c3b069fe` 中 `prototypes/runtime-lifecycle/preview.webm` 字节完全一致，SHA256 均为：

```text
b9259b8902c4dd55099049caa3cd04bbd0b42f77f0214bdd12beba3aa4f570d4
```

执行命令：

```bash
ffprobe -v error -show_entries stream=codec_name,codec_type,sample_rate,channels:format=duration -of json http://127.0.0.1:48761/preview.webm
ffmpeg -hide_banner -i http://127.0.0.1:48761/preview.webm -vn -af volumedetect -f null -
```

结果：VP8 视频、Opus 音频，48 kHz 单声道，容器时长 4.025 秒。音轨完整解码，退出码 0；192819 个样本，平均 −47.1 dB、峰值 −43.5 dB。说明媒体包含非静音音频数据，不能证明 Codex 播放路径或实际听音设备正常出声。未修改原媒体，未调用付费服务。

## 人工验收结果

用户在本次会话中反馈：

> 「播放→暂停→继续→拖动后播放」流程正常，使用远程桌面音频，本地扬声器音量70%

此前给出的操作要求是使用鼠标播放、暂停、继续，再拖动到约 2 秒播放；用户确认了整体流程，未报告精确拖动位置。

| 操作 | 人工听感 |
| --- | --- |
| 播放时能听到合成轻音 | 通过，依据用户对试听流程正常的确认 |
| 暂停时停止出声 | 通过，同上 |
| 继续播放时声音恢复正常 | 通过，同上 |
| 拖动后声音正常、无明显异常 | 通过，同上 |

本轮无人工报告的听音失败，无需进行故障归因。实际出声结论来自用户试听，媒体解码与页面状态仅作为辅助证据。未独立验证 Ubuntu 机器自身扬声器直接输出，也未验证其他平台。

本次仅新增验证文档，未修改程序或媒体；没有适用的类型检查或代码测试。本轮媒体校验、解码检查和人工试听的证据如上。
