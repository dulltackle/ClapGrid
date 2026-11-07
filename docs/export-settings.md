# 全片导出设置

## 首次配置与作用范围

通过面板的「更多 → 导出设置」查看或编辑。设置按项目保存，重开后恢复。

| 参数 | 默认值与范围 |
| --- | --- |
| 编码 | 默认 H.264（`libx264`），可选 MPEG-4 Part 2（`mpeg4`） |
| 帧率 | 默认 30 fps，可选 24、25、30、50、60 fps |
| 输出 | 固定为 16:9、1920×1080、MP4，像素格式为 yuv420p |

保存和导出校验会实际编码与解码临时视频，确认所选参数和兼容预览所需组件可用。设置保存遵守普通修改权和任务锁，下一次导出使用当前设置。

全片导出前须由 agent 设置项目风格。项目风格决定字幕的字体、排版和出场方式。每个口播片段的文案由风格字幕模块逐帧绘制成透明层，贯穿片段并叠在画面最上层。未设置项目风格时仍可制作片段合成预览，预览会标明字幕缺失的原因。详见[风格指南](styles.md)。

## 媒体环境与跨平台范围

导出使用 Linux 的固定版本 Chrome Headless Shell 和 FFmpeg、ffprobe。FFmpeg 需提供 libx264、原生 mpeg4、ffv1、AAC、libvpx 和 libvorbis。用户目录的 Noto Sans CJK SC 继续提供页面和字幕绘制的中文后备字体。组件安装见[Linux 用户目录运行组件](linux-components.md)。

macOS、Windows 的浏览器组件与导出分别跟踪于 [#27](https://github.com/dulltackle/ClapGrid/issues/27) 和 [#28](https://github.com/dulltackle/ClapGrid/issues/28)。
