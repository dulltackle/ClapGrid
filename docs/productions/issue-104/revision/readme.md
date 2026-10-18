# full-rough-v2 修订制作

> 历史记录：原始材料已退出当前 Git 跟踪；复现前请按[原件保留与恢复说明](../../README.md)恢复对应工程或证据。本页不代表当前版本验收。

用户完整审阅 full-rough-v1 后指出：每幕动作不明显、转场不足且反复同一构图、Remotion 叠加不精致且与素材风格不一致。v1 终审未通过，原视频、原声、档案和当次技术证据保留。本目录是反馈修订，不重新生成配音或修改确认旁白。

本次增加全股骨定位、局部关节面、组织大近景和结尾对照等取景，明确镜头位移、供血流动、细胞状态、局部修复、承重与下陷的可见过程。全部结构、箭头和标注使用共同纸纹、温暖色洗及圆润线条。转场是每段画面前 14 帧的纸边擦入，使用前段末画面；音频不交叠，旁白原速及 68.04 秒实际总长保持。

FH10 当前为重新绘制的整段 scene-v2，仍使用原稳定身份与原配音，不继承 #110 “仅箭头放慢、预定ROI不变”的旧版比较结论。原 slow-v3 及修改前/恢复版继续保留于既有档案，回退演练不覆盖当前项目。

制作卡在 cards.json 与 cards/，当前唯一装配角色指向 revision/outputs/<编号>-assembly.mp4；完整审阅角色为 revision/outputs/full-rough-v2.webm，并给出实测原声累计时间窗。旧资产UUID、旧角色纠正和过时关联字段已从当前卡清除。旧卡只作明确的 previous 来源，不能覆盖当前选择。

先完成 15 段纯素材与 45 个无损帧。随后仅把 FH08、FH09、FH10 三句底部提示语改成面向观众的表述，未改旁白或机制含义，仅重渲受影响的三段；独立审查发现后继 FH11–FH12 的前14帧冻结旧FH10文字，追加重渲此一段并保留0/7/13/14帧边界样本；其余十一段保留。三个各段 35%、72%、93% 采样在预定底部文字区域外逐字节一致。outputs/render-delivery.json 保留每段实际渲染批次和当时源码SHA，render-sources/ 保留三批准确源码快照；不是宣称每段都由后改说明的同一源SHA生成。

运行制作类型检查：`./node_modules/.bin/tsc --noEmit -p revision/tsconfig.json`。纯素材生成：`node revision/render.mjs`；三段文字修订：`node revision/render.mjs --ids FH08,FH09,FH10`；后继转场修订：`node revision/render.mjs --ids FH11-FH12 --record render-transition-correction.json --boundary`。媒体核对：`python3 revision/verify.py .`。锁定的渲染依赖沿用 Remotion 4.0.421、React 19.2.0 和 TypeScript 5.9.3。Studio 预览使用同版本 CLI，启动 `remotion studio revision/entry.tsx --no-open`，FullRevision 是制作预览，不能代替真实 ClapGrid 全片导出。

开发检查已核对15原任务与原声SHA、确认原文/声音、静音纯素材尺寸/帧率/完整帧长及完整解码。纯素材无旁白和烧录旁白字幕，最终声音和整段字幕仍由实际 ClapGrid 导出。真实ClapGrid完整导出任务 d3a008e7-9128-46f7-94be-bf4293b2b730 已成功15/15、无issues/warnings。MP4与WebM原字节保存于outputs/full-rough-v2.*，15段原声全span与句尾按48k累计位置核对、全长解码与黑帧开发检查通过；详见evidence/full-media-development.json及current-inputs.json。导出前后公开宿主/配音/设置证据仅采样同一15输入与有效原声。独立封存、固定提交正式验收及用户对 full-rough-v2 的风格/动作/转场/字幕/节奏终审由后续外部记录明确补齐，不能由有限采样或本说明代签。
