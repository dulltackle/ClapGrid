# Codex 媒体生产表格插件 MVP

## 1. 产品定位

本项目第一版定位为一个 **Codex-native 的媒体生产表格插件**。

它不是传统 Excel，也不是单纯的素材管理器，而是一个以“表格”为核心交互界面的媒体生产工作台。

用户可以在表格中：

- 上传和管理文字、图片、音频、视频素材
- 直接编辑文案、标签、角色、状态等字段
- 根据文案生成配音
- 试听生成的音频
- 查看图片和视频缩略图
- 将素材与脚本、镜头、场景建立关联
- 批量选择多行执行操作

同时，Codex 可以通过 MCP 操作同一份数据，例如：

- 查找没有配音的文案
- 批量生成配音
- 更新状态
- 关联已有素材
- 查询指定角色、场景或标签下的素材
- 扫描本地素材目录并自动导入

产品核心原则：

> 用户和 AI 操作同一套数据、同一套业务能力。

---

# 2. MVP 目标

MVP 重点验证三个核心价值。

### 2.1 表格是否适合作为媒体生产工作台

验证用户是否能够通过表格高效完成：

- 文案编辑
- 素材上传
- 素材查看
- 配音生成
- 状态管理
- 批量处理

### 2.2 Codex 是否能够有效操作媒体生产流程

验证用户是否可以直接对 Codex 下达类似指令：

> 找出所有还没有配音的文案。

> 把第 3 到第 10 行用 Alice 的声音生成配音。

> 找出所有包含“产品介绍”的脚本。

> 把这些素材标记为已完成。

> 把 `/assets/new/` 目录里的素材导入项目。

### 2.3 人工操作和 AI 操作是否可以共享同一套数据

例如：

用户手动修改文案：

```text
欢迎来到我们的频道
```

修改为：

```text
欢迎来到我们的新频道
```

随后点击“生成配音”。

与此同时，Codex 也可以执行：

```text
重新生成所有文案已修改但配音未更新的记录
```

两者最终都通过同一套业务层执行。

---

# 3. MVP 非目标

第一版不做完整 Spreadsheet 产品。

明确暂不包含：

- Excel 公式系统
- Excel 文件兼容
- 跨 Sheet 引用
- 单元格合并
- 复杂条件格式
- 任意单元格样式系统
- 数据透视表
- 宏
- VBA
- 多人实时协作
- 云端账号体系
- 云端同步
- 视频剪辑时间线
- 完整 DAM / MAM 系统
- AI 自动生成完整视频

因此第一版不采用 Univer 这类完整 Spreadsheet Engine。

---

# 4. 核心架构

整体架构：

```text
                     Codex
                       │
                  Skill / MCP
                       │
                       ▼
                ┌──────────────┐
                │ AssetService │
                └───────┬──────┘
                        │
          ┌─────────────┼─────────────┐
          │             │             │
          ▼             ▼             ▼
       SQLite      File System     MediaService
                                      │
                            ┌─────────┴─────────┐
                            │                   │
                         ffmpeg             VoiceService
```

用户界面：

```text
                    AG Grid
                       │
                       ▼
                 AssetService
```

最终形成：

```text
              ┌─────────────┐
              │    Codex    │
              └──────┬──────┘
                     │ MCP
                     ▼
                AssetService
                     ▲
                     │
              ┌──────┴──────┐
              │   AG Grid   │
              │ 用户操作界面 │
              └─────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
      SQLite      本地文件       ffmpeg
                                  │
                                  ▼
                              VoiceService
```

---

# 5. 技术选型

## 5.1 Codex Plugin

第一版以 Codex Plugin 作为产品入口。

插件组成：

```text
media-production/
│
├── plugin manifest
│
├── skills/
│   └── media-production/
│       └── SKILL.md
│
├── mcp/
│   └── server
│
├── ui/
│   └── media-table
│
└── services/
    ├── AssetService
    ├── MediaService
    └── VoiceService
```

Skill 负责告诉 Codex：

- 有哪些素材类型
- 如何查询素材
- 如何生成配音
- 如何处理批量操作
- 什么情况下调用哪些 MCP Tools

MCP Server 负责实际执行操作。

---

# 6. 表格技术

MVP 使用：

**AG Grid Community**

原因：

- 原生支持 Cell Editing
- Row Selection
- Sort
- Filter
- Virtual Scrolling
- Keyboard Navigation
- Custom Cell Renderer
- Custom Cell Editor
- 批量行操作
- 容易实现图片、音频、视频类型 Cell

第一版不使用 Univer。

TanStack Table 可作为未来更轻量的备选，但 MVP 优先降低 UI 基础设施开发成本。

---

# 7. 数据存储

## 7.1 SQLite

SQLite 是项目的 Source of Truth。

所有结构化数据均存储在 SQLite。

媒体文件本身不存入 SQLite。

例如：

```text
project/
├── project.db
│
├── assets/
│   ├── images/
│   ├── audio/
│   ├── video/
│   └── scripts/
│
├── generated/
│   └── audio/
│
└── cache/
    └── thumbnails/
```

---

# 8. 核心数据模型

第一版核心对象为 `Asset`。

```ts
type AssetType =
  | "text"
  | "image"
  | "audio"
  | "video"

type Asset = {
  id: string
  projectId: string

  type: AssetType

  name: string
  path?: string

  text?: string

  status?: string

  duration?: number

  width?: number
  height?: number

  metadata?: object

  createdAt: string
  updatedAt: string
}
```

---

# 9. 数据库设计

## assets

```text
assets
------
id
project_id
type
name
path
text
status
duration
width
height
metadata_json
created_at
updated_at
```

## asset_tags

```text
asset_tags
----------
asset_id
tag
```

## asset_links

```text
asset_links
-----------
source_id
target_id
relation
```

典型关系：

```text
script → audio
script → image
script → video

scene → script
scene → image
scene → video

shot → audio
shot → video
```

---

# 10. 表格数据模型

表格中“一行”代表一个生产记录。

典型视图：

| 场景 | 文案 | 角色 | 配音 | 图片 | 视频 | 状态 |
|---|---|---|---|---|---|---|
| 01 | 欢迎来到我们的频道 | Alice | ▶ 4.6s | 图片 | 视频 | 完成 |
| 02 | 今天介绍一个新功能 | Alice | 生成配音 | 图片 | — | 待制作 |

第一版不把所有东西都建模为传统 spreadsheet cell。

而是使用类型化字段。

---

# 11. Cell 类型

MVP 至少提供以下 Cell。

## TextCell

用于：

- 文案
- 标题
- 镜头说明

支持直接编辑。

---

## ImageCell

显示：

```text
┌──────────┐
│ Thumbnail│
│          │
│ Replace  │
└──────────┘
```

支持：

- 上传图片
- 替换图片
- 查看大图
- 删除关联

---

## AudioCell

例如：

```text
▶ 00:04.6   ↻   ⋮
```

支持：

- 播放 / 暂停
- 显示时长
- 上传音频
- 生成配音
- 重新生成
- 替换
- 删除

---

## VideoCell

例如：

```text
┌──────────────┐
│ thumbnail   ▶│
│ 00:08.4      │
└──────────────┘
```

支持：

- 视频缩略图
- 时长
- 打开/播放
- 上传
- 替换

---

## StatusCell

下拉选择，例如：

```text
待制作
制作中
待审核
已完成
```

---

## TagCell

支持：

```text
Alice
开场
产品介绍
室外
```

---

# 12. 上传能力

用户可以通过：

- 点击上传
- 拖拽文件
- 导入目录

添加素材。

支持第一版文件类型：

### 图片

```text
png
jpg
jpeg
webp
```

### 音频

```text
wav
mp3
m4a
aac
```

### 视频

```text
mp4
mov
webm
```

系统导入素材后自动：

```text
生成 asset_id
↓
保存/记录文件路径
↓
提取 metadata
↓
写入 SQLite
↓
表格更新
```

---

# 13. MediaService

MediaService 负责媒体文件处理。

例如：

```ts
probeMedia(path)
generateThumbnail(path)
getImageMetadata(path)
```

视频通过 `ffprobe` 提取：

```text
duration
width
height
fps
codec
```

音频提取：

```text
duration
codec
sample_rate
channels
```

图片提取：

```text
width
height
format
```

---

# 14. 配音生成

这是 MVP 的核心生产能力之一。

通过统一：

```text
VoiceService
```

提供：

```ts
generateVoice({
  text,
  voiceId,
  speed?,
  emotion?
})
```

VoiceService 与具体供应商解耦。

未来可以接：

```text
OpenAI TTS
ElevenLabs
Azure
本地 TTS
其他供应商
```

MVP 可以只实现一个 Provider。

---

# 15. 配音生成流程

用户在表格中输入：

```text
欢迎来到我们的频道
```

点击：

```text
生成配音
```

调用：

```text
VoiceService.generateVoice()
```

生成：

```text
generated/audio/audio_001.wav
```

然后：

```text
创建 audio asset
↓
建立 script → audio 关系
↓
更新数据库
↓
AudioCell 自动刷新
```

最终：

```text
▶ 00:04.6
```

---

# 16. 用户操作与 Codex 操作统一

非常重要：

用户 UI 不直接实现一套逻辑。

Codex MCP 也不单独实现一套逻辑。

两者都调用：

```text
AssetService
MediaService
VoiceService
```

例如：

```text
AG Grid
   │
   ▼
generateVoice()
   │
   ▼
VoiceService
```

Codex：

```text
MCP Tool
   │
   ▼
generateVoice()
   │
   ▼
VoiceService
```

因此不会出现两套行为不一致的问题。

---

# 17. MCP 定位

MCP 不是 Spreadsheet API。

不要主要提供：

```text
write_cell
read_cell
set_cell_value
```

而是提供业务语义 API。

例如：

```text
search_assets
update_asset
generate_voice
attach_asset
```

Codex 操作的是：

```text
素材
文案
场景
配音
关系
```

而不是：

```text
A23
B42
C17
```

---

# 18. MVP MCP Tools

第一版控制在约 10 个 Tool。

## scan_assets

扫描目录并导入素材。

```ts
scan_assets({
  path,
  recursive
})
```

---

## search_assets

统一素材查询入口。

```ts
search_assets({
  text?,
  type?,
  tags?,
  status?,
  sceneId?,
  missing?,
  limit?
})
```

例如：

```text
找出所有没有配音的文案
```

---

## get_asset

```ts
get_asset({
  id
})
```

返回完整素材信息。

---

## create_asset

用于创建：

- 文案
- 外部素材记录
- AI 生成素材记录

---

## update_asset

```ts
update_asset({
  id,
  patch
})
```

例如：

```text
修改文案
修改状态
修改标签
```

---

## delete_asset

删除记录。

实际文件删除需要明确区分：

```text
只删除数据库记录
```

和：

```text
同时删除文件
```

MVP 默认优先安全策略。

---

## link_assets

```ts
link_assets({
  sourceId,
  targetId,
  relation
})
```

例如：

```text
script → voice
script → image
shot → video
```

---

## unlink_assets

解除关系。

---

## generate_voice

```ts
generate_voice({
  assetId,
  voiceId,
  speed?,
  emotion?
})
```

根据文案 asset 生成音频。

---

## probe_media

读取媒体元数据。

---

# 19. Codex Skill

Skill 主要描述：

- 数据结构
- Tool 使用原则
- 媒体生产工作流
- 批量操作方式
- 什么情况下生成素材
- 什么情况下只查询
- 如何避免覆盖用户已有数据

例如用户说：

> 把没有配音的 Alice 文案全部生成配音。

Codex 应理解为：

```text
search_assets
↓
筛选 Alice + missing audio
↓
逐条 generate_voice
↓
汇总结果
```

---

# 20. MVP 用户工作流

## Workflow A：建立项目

用户创建项目。

导入：

```text
/scripts
/images
/audio
/video
```

系统自动扫描。

---

## Workflow B：编辑文案

用户直接修改 TextCell。

保存后写入 SQLite。

---

## Workflow C：生成配音

用户点击 AudioCell：

```text
生成配音
```

选择：

```text
Alice
```

生成后自动回填。

---

## Workflow D：批量生成

用户勾选 10 行：

```text
批量生成配音
```

系统依次生成并更新。

---

## Workflow E：Codex 自动处理

用户：

> 找出所有没有配音的文案，然后使用 Alice 生成。

Codex 调用 MCP 完成。

---

## Workflow F：上传素材

用户把图片拖到某行。

系统：

```text
导入文件
↓
创建 asset
↓
关联当前记录
↓
更新 ImageCell
```

---

# 21. 表格与数据关系

表格不是数据库。

表格是：

```text
Database Grid / Media Production Grid
```

SQLite 才是数据源。

因此：

```text
表格排序
≠ 修改数据库顺序

表格过滤
≠ 删除数据

表格行号
≠ Asset ID
```

所有业务操作必须围绕稳定的：

```text
asset_id
record_id
scene_id
```

进行。

---

# 22. MVP UI 范围

第一版界面只需要：

### 顶部工具栏

```text
上传素材
扫描目录
新增行
删除
批量生成配音
过滤
搜索
```

### 中间

AG Grid。

### 底部 / 右侧可选

素材详情面板。

例如：

```text
文件名
路径
时长
分辨率
标签
关联素材
```

不需要复杂多页面结构。

---

# 23. 第一版性能目标

目标规模：

```text
1,000～10,000 条记录
```

单项目素材：

```text
几 GB ～ 数百 GB
```

媒体文件大小不影响数据库主体，因为数据库只存索引和 metadata。

表格通过虚拟滚动保持流畅。

---

# 24. 安全原则

MCP 对本地文件的访问应有明确项目范围。

例如项目根目录：

```text
/project/
```

默认不允许 Codex 任意访问：

```text
/
~/Documents
其他项目
```

除非用户明确授权。

删除文件、覆盖文件、批量生成等高影响操作需要明确区分。

---

# 25. MVP 成功标准

MVP 成功的最低标准：

### 用户侧

用户可以：

1. 创建一个本地媒体项目
2. 上传图片、音频、视频
3. 编辑文案
4. 在表格里查看素材
5. 根据文案生成配音
6. 直接试听配音
7. 批量修改状态

### Codex 侧

Codex 可以：

1. 查询素材
2. 查找缺失素材
3. 修改记录
4. 建立素材关系
5. 扫描目录
6. 根据文案生成配音
7. 批量完成上述操作

### 数据侧

所有人工和 AI 操作最终落到：

```text
SQLite + 本地文件系统
```

没有两套状态。

---

# 26. MVP 推荐技术栈

```text
Codex Plugin

Frontend
- React
- TypeScript
- AG Grid Community

Backend / Service
- TypeScript 或 Rust
- SQLite

MCP
- MCP Server
- 本地 stdio 优先

Media
- ffmpeg
- ffprobe

Voice
- VoiceService abstraction
- MVP 先接一个 TTS Provider
```

---

# 27. MVP 一句话定义

> 一个运行在 Codex 插件体系中的 AI-native 媒体生产表格：用户可以在表格中编辑文案、上传和管理图片/音频/视频、从文案生成配音；Codex 通过 MCP 操作同一套素材数据和生产能力。

---

# 28. 后续扩展方向

MVP 验证成功后再考虑：

```text
图片生成
视频生成
字幕生成
语音识别
自动镜头匹配
Embedding / 语义搜索
素材去重
版本管理
多人协作
独立桌面 App
时间线编辑器
批量渲染
工作流编排
```

最终可以从：

```text
AI-native Media Spreadsheet
```

逐步发展为：

```text
AI-native Media Production Workspace
```