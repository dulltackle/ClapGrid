# FH01–FH04 制作与复现说明

本组为 #106 的制作资产，复用 #105 制作工程，未修改产品代码或通用渲染接口。旁白逐字沿用 #96 v0.2；片段身份与顺序见根制作目录 `segment-mapping.json`。所有场景使用相同近端股骨几何与构图，不含裂隙、塌陷、坏死病灶或必经阶段箭头。文字独立成层，纹理 seed=17，结构下界 y=776，底部旁白区保留。

改了什么：新增开场提问、股骨头定位、三层结构标注和骨组织的氧气营养供给示意；实际有效配音直接复制复用，未重新请求或变速。各段无声装配与带配音完整字幕审阅预览分别输出，另有本组连续预览。

之前确认过什么：#96 已确认文字，#97 温暖分层规则与结构静态参考，以及 #100 Remotion/SVG 路线。`references/106-sources.json` 保存固定来源提交和参考校验值，`106-image-generation.json` 保留既有图像生成记录。本轮没有新增 imagegen 调用。既有确认不扩大为本组新动画或人工听审通过。

这次需要看什么：开场提问、股骨头定位、三层结构指示线落点、标注和字幕可读性、氧气营养的衔接、四段节奏与人工听审。技术核对、画面确认、人工听审、全片终审分别记录在 `106-review-status.json`。未执行部分保持待审。

## 来源与医学表达

FH03 软骨端点 `(685,200)` 落在青绿色软骨；软骨下骨层端点 `(680,278)` 落在浅色带内；骨小梁端点 `(756.32,391.2)` 是共享浅桃色支撑曲线 `M671 342 Q734 380 824 428` 的 t=0.6 中心点。三条指示线分开，不穿插标签，未把深珊瑚骨髓间隙当成骨架。画面保留颜色及厚度为示意的说明。

FH04 仅用少量正常细分支、沿路径移动的短线和“氧气与营养”文字表示持续供给。路径限制在骨组织内部，是机制概括；不命名血管、添加血栓或病变，不增加确认旁白以外的医学断言。

## 复现命令

在制作目录执行：

```sh
npm ci --cache /home/forclaw/tmp/npm-production-cache
./node_modules/.bin/tsc --noEmit --strict --jsx react-jsx --module ESNext --moduleResolution bundler --target ES2020 --esModuleInterop --skipLibCheck entry106.tsx
python3 evidence/106-render-group.py --log-dir /tmp/group106-render-logs
```

脚本从每张制作卡的实际原 MP3 重新 ffprobe，补足到整帧后输出 `FH01` 至 `FH04` 的 `*-assembly.mp4`、`*-review.mp4`、`*-review.webm`、PNG 与渲染元数据；再解码拼接连续 `group106-review.mp4` 和 WebM 浏览器副本。装配素材 1920×1080、30 fps，无音轨和旁白字幕；审阅 MP4 有完整旁白与字幕，WebM 为 960×540 浏览器副本，不代替正式尺寸探测。

原音频从现有 ClapGrid 成功任务复制，声音、任务和输入匹配依据为本组 `106-actual-speech.json`，包含真实采集起止时间及外部原始记录 SHA。未使用项目/任务创建时间替代采集时间，公开证据不携带会话能力 URL。

本组独立档案路径 `/home/forclaw/tmp/implement-spec-104/archives/group106-v1`。档案包含共享工程、独立入口和场景、制作卡、旁白与原声、预览、中文字体与许可、固定参考及生成来源、锁文件和实际 Linux x64 依赖资源包。新版本另存，旧版保留至试点结束。

从档案恢复依赖并仅重新渲染代表段 FH03：

```sh
tar -xzf dependency-resources-linux-x64.tgz
python3 evidence/106-render-group.py --representative-only --log-dir /tmp/group106-restored-render-logs
python3 evidence/106-verify-delivery.py /home/forclaw/tmp/implement-spec-104/archives/group106-v1
```

恢复目录必须包含清单所有文件且校验一致。代表段重渲染保存在 `outputs/group106-reproduced/`，保留原本已实际关联的视频，不冒充将重渲染产物重新关联到项目。重渲染后应记录新的输出校验清单，并重新探测、解码和播放；不要求有损视频压缩字节相等。代表段复现不代替其他段或全片终审。Node 22、Linux x64 依赖资源、Chrome `/usr/bin/google-chrome` 和 FFmpeg/ffprobe 是本轮执行环境；归档的中文 OTF 字体不依赖宿主安装。
