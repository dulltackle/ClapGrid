# 成人股骨头机制视频制作工程

> 历史记录：原始材料已退出当前 Git 跟踪；复现前请按[原件保留与恢复说明](../README.md)恢复对应工程或证据。本页不代表当前版本验收。

本目录是 #104 的制作资产，不是产品模块。制作基线为 1920×1080、30 fps，温暖分层风格。FH10 已建立当前独立审阅版本 `fh10-v1`，源自 #100 已确认画面，但本次音频、渲染、解码与归档验证重新执行。完整片段身份及顺序在 `segment-mapping.json`；FH11–FH12 合并为一个口播片段，文字原样保留。

## 复现与扩展

在本目录执行：

```sh
npm ci --cache /home/forclaw/tmp/npm-production-cache
npm run typecheck
npm run render
```

需要 Node.js 22、FFmpeg/ffprobe、Chrome（默认 `/usr/bin/google-chrome`，可用 `--browser` 或 `CHROME_PATH` 指定）。依赖由本目录锁文件固定，中文字体从归档文件加载，失败则停止渲染。`render.mjs` 每次从制作卡 `audio` 文件重新实测时长并向上补足到整帧，原速完整保留旁白。

- `outputs/FH10-assembly.mp4` 是 ClapGrid 装配画面，含结构标注，无音轨、无旁白字幕。
- `outputs/FH10-review.mp4` 是独立审阅预览，含原速配音及完整旁白字幕，不作为装配输入。
- `outputs/FH10-render.json` 记录本次实测音频、帧数和入口；静态 PNG 用于画面检查。
- `cards/FH10.json` 保存制作卡、当前输入快照、稳定身份、依据与审阅范围。

后续各组各自建立入口，例如 `group-a.tsx` 调用 `registerProduction(Scene)`，通过 `npm run render -- --entry group-a.tsx --card cards/FH01.json --out outputs` 渲染。各组拥有自己的入口、片段场景与制作卡，协调者拥有共享文件，避免并行改动冲突。场景接收 `SceneProps`，使用 `card.durationInFrames` 驱动动作；不得固定旧配音秒数。

`src/anatomy.tsx` 的 `AnatomyDefs` 与 `BoneGeometry` 保留 #100 几何和固定纹理 seed=17。`ExistingFracture` 独立导出，仅 FH10 使用；健康结构不得继承裂隙。所有图形坐标采用 1672×940 viewBox，输出映射到 1920×1080。共享 `Canvas`、`palette`、`TextLayer` 位于 `src/shared.tsx`，文字独立成层；关键结构尽量不超出 y=780，旁白保留 y=820–865 区域，说明脚注 y=913。结构、指示线和文字必须逐组核对，不能仅因复用几何继承医学含义确认。

FH10 箭头原动作按实测帧数缩放，放大图独立；裂隙在第一帧即已存在，不由一次承重产生。`motion.slow` 只改变箭头移动时长，供 #109 局部返工与恢复使用。

## 来源与字体

几何取自固定提交 `fa19a47f326b50d793ff3378962718523f99784d:docs/prototypes/issue-100-animation/index.tsx`，视觉参考与图像生成记录取自 `67166d4e966739f5ec669ea977589e42a5544c7d:docs/prototypes/issue-97-style/`。仅提取明确文件，不合并原型分支；本轮未重新生成图像。`references/fh10-reference.png` 为动画参考，`fh10-static.png` 为原静态稿；`static-*.json` 是历史生成/来源记录，其中旧工作目录仅用于追溯，不是复现依赖。

字体源为本机发行版 Noto Sans CJK SC Regular 集合 `/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc`（第 2 号字体）。`public/fonts/OFL-and-source.txt` 保存发行版来源、版权与 SIL OFL 1.1；归档的是实际 `noto-cjk-sc.otf`，中文基本/扩展 A 区、标点及全角字符均保留，覆盖完整已确认旁白与结构标注，不依赖宿主安装字体。子集命令：

```sh
pyftsubset /usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc --font-number=2 --unicodes='U+0020-007E,U+00B7,U+2000-206F,U+3000-303F,U+3400-9FFF,U+FF00-FFEF' --output-file=public/fonts/noto-cjk-sc.otf
```

本机 Python 包入口另用 `PYTHONPATH=/home/forclaw/.local/lib/python3.12/site-packages python3 -c 'from fontTools.subset import main; main()'` 代替 `pyftsubset`。复现已归档工程不需要再次生成字体。

## 本版审阅说明

改了什么：从原型转为可复用制作工程，补齐当前身份及制作卡，按当前实际音频重新渲染，拆分无声装配与配音字幕预览，实际保存独立档案并从档案重新渲染。

之前确认过什么：#96 v0.2 旁白、#97 温暖分层与关键机制规则、#100 FH10 原型画面表达。来源链接保存在制作卡。确认未扩大到当前全片。

这次需要看什么：当前 FH10 画面、完整字幕、箭头与放大图节奏及人工听审；全片连续性和终审待后续工单。技术核对、用户画面确认、人工听审及全片终审在 `evidence/FH10-review-status.json` 分开保存，未执行项保持待审。

独立档案为 `/home/forclaw/tmp/implement-spec-104/archives/fh10-v1`，实际保存输入音频、旁白、制作卡、源文件、锁定依赖说明、字体、参考来源、输出和文件校验清单。新版本另存，旧版保留至试点结束。当前本地项目身份、完整映射、FH10 装配关联及声音核对采用协调者本轮真实 MCP 采集的 `evidence/fresh-host.json`、`fresh-project.json`、`fresh-speech.json`；调用时间范围为 2026-10-12T07:00:37.260Z–07:00:38.400Z，采集范围及原始/公开文件 SHA-256 见 `evidence/FH10-current-collection.json`。旧 `host-before.json`、`speech-before.json`、`speech-mapped.json` 未记录采集时间，仅保留为历史参考，不以项目或任务创建时间替代观察时间。本工单未创建新项目、重新生成有效配音或更新插件。

档案另保存实际安装依赖 `dependency-resources-linux-x64.tgz`（本轮 Linux x64 环境），清单包含校验值。可在恢复目录解包该文件后运行 `npm run render`；换操作系统应从锁文件重新 `npm ci`，浏览器和 FFmpeg 仍由执行环境提供。生成的 `bundle/` 与展开的 `node_modules/` 不作为源清单条目，后者完整资源已在依赖压缩包内。执行 `python3 verify-media.py <档案目录>` 核对清单以及正式 MP4/WebM 全长无错误解码；通过不代替真实浏览器播放或人工听审。
