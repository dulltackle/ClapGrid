# 完整粗剪开发交付

> 历史记录：原始材料已退出当前 Git 跟踪；复现前请按[原件保留与恢复说明](../README.md)恢复对应工程或证据。本页不代表当前版本验收。

本轮仅制作 #111 公开媒体、输入和独立完整档案，没有改动产品源码、宿主配置或发起新的配音。真实 ClapGrid 任务 `2846fb35-8435-4043-b0d7-e7aa9f5a2b75` 成功完成十五段；原声合计 68.04 秒，1920×1080、30 fps 的原 MP4 和原生 WebM 均直接复制。视频2041帧即68.033333秒，与原声差0.006667秒，小于一帧；不为90秒预算裁切或变速。

| 条件 | 范围和证据 |
| --- | --- |
| 当前顺序与文案 | `full-inputs/current111.json` 与 `segment-mapping.json` 逐段对应；v0.2精确原文十五段；FH11–FH12合并；FH10唯一当前卡 `cards/FH10-slow.json`、`fh10-slow-v3`。 |
| 实际有效原声 | `evidence/111-host-before.json`、`111-speech-before.json`；十五任务 succeeded、audio valid，任务文本/声音/卡/原MP3字节相符。前后端点采样同实例且快照一致，未声明持续监测。 |
| 纯画面输入 | 十五实际关联 `<assetId>.source` 逐字节等于明确已审装配、无音轨/字幕流；`render.mjs`装配preview=false且muted，`src/shared.tsx`不画旁白TextLayer；独立源码阅读需核对烧录字幕角色，不能只凭无字幕流证明。 |
| 真实导出 | `111-export-succeeded.json` 和 `111-settings-before.json`；真实任务成功15/15、无问题或警告、1080p30、Noto Sans CJK SC。实际ASS的TTC与授权、动画OTF分别保存，SHA见resources111.json。 |
| 媒体工程检查 | `111-verification.json`：两个媒体全长decode exit0 stderr空，无黑帧；原声48k完整span的精确累计位置均>.97，句尾半秒均>.97，WebM全span亦>.97。root实际完整从0播放到68.056 ended、rate1未静音无错误见111-browser-full-playback.json。15个72%单帧的字幕观察见111-frame-samples.json；另保存30个首末/边界邻帧；协调者实际view并对SHA其中首末帧及FH09→FH10、FH10→FH11–FH12两处边界前后共6张，字幕对应切换、主骨结构位置一致，未见重复残留或黑屏，记录见111-boundary-observation.json。其他24边界帧未视查，不代逐帧或医学/节奏终审。 |
| 完整独立档案 | 外部archives/full-rough-v1纳十五当前卡、完整生产源、十五原声与关联素材、参考图/生成清单/提示词、锁定依赖及字体授权、真实全片和预览、技术证据。manifest以schemaVersion=2集中列出change、十五段身份/任务输入、production参数/entry/纹理seed/字体、真实export、confirmationSources与reviewScope；列所有实际文件SHA且不自列；旧档案保留。独立副本media/源/资源再次核对通过，恢复源typecheck通过；没有要求先重复真实全片导出。 |
| 分开审阅状态 | `review111.html`列变化/已有确认/待看及三问；`111-review-status.json`分别保存同步技术、抽帧观察、人工听审、新画面确认、全片终审和正式验收。用户医学/风格/发音/节奏与全片终审保持pending。 |

工作树基线 `c117e34bc1723d00bf553c7d752fa5b6eb171b5b`，已同步协调者六份已审106/108补记录到 `3e4fccbc8fdd4a9c270eb8b60a2ba19d4579479d`；源与媒体没有变化。源码、安装包、实际宿主三层分别是：只新增制作档案；安装包未改；实际宿主build907c064的本轮任务及端点采样有证据。

运行命令：`python3 verify111.py <制作目录或独立档案目录> --logs <外部日志目录> --report <外部报告路径>`。首次缺输出和后续缺完整输入计划的红证据保存在外部111-red.log/111-red-plan.log，已复制进档案execution-logs。现行和独立恢复源typecheck的实际命令/结果在111-typecheck.json；完整媒体实际解码stderr日志与blackdetect日志在档案execution-logs，具体边界提取命令在111-boundaries.json。

档案外的111-archive.json、111-archive-verification.json、111-source-identity.json为最终封存的摘要/哈希指针，不复制回档案造成循环；档案内部archive-source.json保存对应基线、当前版本、资源、参数和恢复命令。开发证据待独立审查后才可集成，不能称为正式固定提交验收通过。
