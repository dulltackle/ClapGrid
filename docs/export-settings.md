# 全片导出设置

## 参数选择依据

| 参数 | 依据 |
| --- | --- |
| 编码：默认 `libx264`（H.264，yuv420p），可选 `mpeg4` | H.264 面向常见播放器，另提供 FFmpeg 原生 MPEG-4 Part 2。当前环境不支持所选编码时明确拒绝，不偷偷切换编码。 |
| 帧率：整数 24、25、30、50、60 | 有限支持集覆盖常用帧率；分数帧率及任意数值不在本版支持范围。 |
| 字体：首次不预选 | 枚举本机 Fontconfig 字族并按完整名称校验；不自动下载字体，不以替代字体掩盖所选字体缺失。字体名中的逗号、换行和空字符不受支持，避免破坏 ASS 样式记录。 |
| 字号：首次不预填，1–1080 px | 以 ASS `PlayResX=1920`、`PlayResY=1080` 的画布像素解释，不依赖屏幕 DPI；指字体标称大小，不保证每个字形的实际像素高度。 |
| 输出：固定 16:9、1920×1080、MP4 | 不能通过设置接口修改分辨率、比例或容器。 |

保存完整配置时实际烧录一份临时 ASS 字幕并编码/解码，确认当前环境能渲染；缺少媒体组件或无法渲染时拒绝保存。导出任务须在自己的任务锁边界读取并固定当前设置，不沿用旧快照。

## 媒体环境与跨平台范围

需要 PATH 中的 FFmpeg、ffprobe、Fontconfig 的 `fc-list`。FFmpeg 需包含 libx264、原生 mpeg4、libass，并使用 Fontconfig 字体提供者。Windows、macOS 同样需要这套组件与字体配置，不能把 Fontconfig 枚举结果直接交给另一字体提供者。新安装或卸载字体后重新打开设置入口刷新列表；下一次导出还会重新校验。

Windows/macOS 的组件安装和实际运行须由 [#11](https://github.com/dulltackle/ClapGrid/issues/11)、[#12](https://github.com/dulltackle/ClapGrid/issues/12) 的平台验收验证；不能将 Linux 结果视为三平台通过。

参考：[FFmpeg subtitles 过滤器](https://ffmpeg.org/ffmpeg-filters.html#subtitles)、[Fontconfig 开发文档](https://fontconfig.pages.freedesktop.org/fontconfig/fontconfig-devel/)、[fc-list 手册](https://xorg.freedesktop.org/archive/X11R7.0/doc/html/fc-list.1.html)。
