# 全片导出设置

## 首次配置与作用范围

通过面板的「更多 → 导出设置」查看或编辑。设置按项目保存，重开后恢复。

| 参数 | 默认值与范围 |
| --- | --- |
| 编码 | 默认 H.264（`libx264`），可选 MPEG-4 Part 2（`mpeg4`） |
| 帧率 | 默认 30 fps，可选 24、25、30、50、60 fps |
| 输出 | 固定为 16:9、1920×1080、MP4，像素格式为 yuv420p |

保存和导出校验会实际编码与解码临时视频，确认所选参数和兼容预览所需组件可用。设置保存遵守普通修改权和任务锁，下一次导出使用当前设置。

全片导出前须由 agent 设置项目风格。项目风格决定字幕的字体、排版和出场方式。每个口播片段的文案由风格字幕模块逐帧绘制成透明层，贯穿片段并叠在画面最上层。未设置项目风格时仍可制作片段合成预览，预览会标明字幕缺失的原因。字幕模块约定见[内置风格](../plugins/clapgrid/styles/README.md#字幕模块)，选用与设置流程见[画面编排制作约定](../plugins/clapgrid/skills/open-clapgrid/references/composition.md#风格)。

## 响度与黑场检查

全片导出采用两遍响度标准化，固定目标为综合响度 −14 LUFS、真峰值 −1.5 dBTP。第二遍优先采用线性增益，遇到响度范围或真峰值限制时由 FFmpeg 切换为动态标准化。校验时，有效配音的最大电平低于 −50 dBFS 会阻止导出并指出对应口播片段。响度测量或标准化失败时，任务失败并清理本次文件。

成片编码后，在完整解码的同一遍复测综合响度、真峰值和响度范围，并检测持续至少 1 秒的黑场。综合响度偏离 −14 LUFS 超过 1 LU、真峰值高于 −1.0 dBTP，或检出黑场时，任务仍可成功。响度警告附实测值，黑场警告附全片时间并定位到每个涉及的口播片段。黑场可能为有意设计。

在面板任务记录中展开成功的全片导出，可查看成片实测响度与真峰值。`clapgrid_export_status` 返回 `technicalChecks`，其中 `loudnessBefore` 和 `loudnessAfter` 分别记录标准化前和复测的 `integratedLufs`、`truePeakDbtp`、`rangeLu`，`blackIntervals` 记录黑场起止秒数。旧任务可能缺少此字段。兼容预览由成片转换，片段合成预览保留配音原音量并跳过这些检查。

这些检查结果仅用于制作者自检。人工审阅的结论按[制作验收证据](production-evidence.md)独立记录。

## 媒体环境与跨平台范围

导出使用 Linux 的固定版本 Chrome Headless Shell 和 FFmpeg、ffprobe。FFmpeg 需提供 libx264、原生 mpeg4、ffv1、AAC、libvpx 和 libvorbis。全片技术检查还需要 `astats`、`loudnorm`、`ebur128`、`blackdetect`、`metadata`、`settb` 和 `tpad` 滤镜。用户目录的 Noto Sans CJK SC 继续提供页面和字幕绘制的中文后备字体。组件安装见[Linux 用户目录运行组件](linux-components.md)。

macOS、Windows 的浏览器组件与导出分别跟踪于 [#27](https://github.com/dulltackle/ClapGrid/issues/27) 和 [#28](https://github.com/dulltackle/ClapGrid/issues/28)。
