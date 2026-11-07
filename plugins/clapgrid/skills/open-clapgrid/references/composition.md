# 画面编排制作约定

本文是口播片段画面编排的唯一规则来源：素材归属、编排、页面图层、风格、制作者自检与片段合成预览。何时开始、做到哪一步等 agent 行为见[打开 ClapGrid](../SKILL.md#逐句画面素材)；风格的编写约定见[内置风格](../../../styles/README.md)。

## 素材与归属

`clapgrid_import_material({ sourcePath })` 导入本地 PNG、JPEG 或视频的绝对路径。图片保持原生身份和透明通道，透明角色使用保留 alpha 的原生 PNG；视频生成静音 WebM 原件预览。仅复制用户指定的普通文件，拒绝符号链接、多硬链接、播放列表和网络引用，不扫描相邻目录。

`clapgrid_modify` 的 `{ kind: "materials", expected, assetIds }` 确认本句使用的素材。移出及删除片段保留项目素材，同一原件可供多句复用。添加素材只确定本句使用哪些素材，不决定展示时间，不自动均分时长、贯穿整句或跨句套用。

## 编排

先生成有效配音，再调用 `clapgrid_visual_context({ segmentId })` 取得当前文案、画面说明、素材、已保存编排及有效配音的精确解码时长（秒）；缺失或待更新的配音会明确拒绝。它同时返回 `page.canvas`（1920×1080）、`page.fps`、`page.assetUrls`（`/assets/<assetId>`）及导入上限。

以最新 `expected` 提交 `{ kind: "composition", expected, plan: { duration, layers } }`：

- 编排时长须与查询得到的有效配音时长一致。
- 素材图层明确 `assetId`、`role`（background／overlay）、`from`、`to`、`start`（秒）、`x`、`y`、`width`、`height`（相对 1920 × 1080 画布）、`z`（背景为 0，叠加为正数）。`kind` 可为 `asset`，省略仍兼容旧编排。
- 背景须连续覆盖整句，本句全部素材须进入编排；同一素材可在多个区间重复引用。
- 导入、关联和编排遵循同一修改权与完整 `expected` 快照核对；失败保留已提交状态，断线后查询确认，不自动重发未知写操作。

用户通过对话要求移动角色、调整出现时机时，重读该句输入、提交新编排并重新生成预览，保留无关片段和项目原件。

## 页面图层

页面用于逐帧动画背景、镜头推拉和透明叠加。

### 导入

在用户工作空间内编写含 `index.html` 的目录，用 `clapgrid_import_page({ sourceDirectory })` 导入为项目 `pages/<SHA-256>/` 内的不可变副本，返回 `pageId`；同一内容重复导入复用身份。源路径须为工作空间内绝对路径；显式项目入口以项目父目录作为工作空间边界。导入限制见[导入边界](#导入边界)。导入时会提示常见的不确定 API，静态提示可能误报。修改页面后重新导入，提交使用新 `pageId` 的编排，旧预览自动待更新。

### 运行约定

- 页面暴露 `window.DUR`（秒）、`window.render(t)` 和加载完成后的 `window.READY = true`，可选 `window.TEXTS(t)`（见[制作者自检](#制作者自检)）。字体、图片、模块及素材须在 READY 前加载完毕，最多等待 120 秒。
- `t` 以图层 `from` 为零点；DUR 等于 `to - from`，误差不超过 1 ms。帧数为 round(DUR×fps)，不足一帧会明确失败。
- `render(t)` 必须独立确定，不依赖上一帧、当前时间或无种子随机数。
- 视口按 1920×width、1080×height 四舍五入到最近偶数（至少 2 px），设备像素比 1，以 innerWidth/innerHeight 布局。
- 页面只能读取自身文件、`page.json` 声明的风格和图层 `assetIds` 声明的本句素材；依赖保存在页面或声明的风格目录内。外网、任意本地路径、WebSocket、WebRTC、Worker 和嵌入框架均被拒绝。
- 页面只输出画面，字幕按导出设置统一烧录。

### 图层字段

页面图层为 `{ kind: "page", pageId, assetIds, role, from, to, x, y, width, height, z }`，没有 `start`。`assetIds` 只声明本句素材，并计入“本句全部素材进入编排”的校验。页面背景同样须连续覆盖整句。

页面渲染失败会在任务问题中指明片段与原因，不产生成片。渲染使用固定浏览器、软件渲染和双页面实例产生 FFV1 中间视频，与预览及导出共用滤镜链；组件来源见 [Linux 组件](https://github.com/dulltackle/ClapGrid/blob/main/docs/linux-components.md)，决策见 [ADR0015](https://github.com/dulltackle/ClapGrid/blob/main/docs/adr/0015-page-rendering.md)。

## 风格

风格由 `STYLE.md`、纯函数 ES module `lib/` 和 `example/` 组成。项目采用的规则仍记录在视觉方案中，风格本身不代表已被采用。

1. 阅读所选内置风格的 `STYLE.md`，将整个风格目录复制到工作空间 `styles/<id>/`，在 `STYLE.md` 头部追加来源 id/version，保留项目版本自己的 id 与 version。插件更新不改变此独立副本。
2. 在 `video.md` 的“风格”小节链接该目录的 `STYLE.md`。先写本项目方案，再阅读示例源码；按 `STYLE.md` 的修改分级调整项目风格。
3. 用 `clapgrid_import_style({ sourceDirectory })` 导入工作空间内的绝对目录，得到 `styleId`；不可变副本存于项目 `clapgrid/styles/<SHA-256>/`。同一内容重复导入返回相同身份；修改工作副本后重新导入，不编辑已导入副本。导入遵循现有修改权流程，限制见[导入边界](#导入边界)。
4. 页面可含严格的 `page.json`：`{ "style": "<styleId>" }`，页面导入时核对风格存在与完整性。模块使用绝对路径导入，例如 `import { draw } from '/styles/<styleId>/lib/draw.js'`。渲染时只开放该页声明的风格；未声明、其他风格或越界路径返回 404，并使任务失败、指明片段。没有 `page.json` 的页面按原页面约定运行。
5. 使用示例时，将 `example/` 复制到风格目录外的页面目录，把 `STYLE_ID` 占位替换为返回的 `styleId`，按实际图层区间调整 DUR，再导入页面。
6. 风格只绘制画面；字幕字体和字号按 `STYLE.md` 推荐写入统一导出设置。

风格变化后重新导入，更新页面声明和模块路径、重新导入页面并保存编排，旧预览随之显示待更新。同时更新采用方案中的风格身份，重新展示动态样片并取得受影响范围的确认；样式稿可选。确认记录格式见[样片接入说明](https://github.com/dulltackle/ClapGrid/blob/main/docs/production-sample.md)。

交付前与示例比较六个维度：题材与对象、构图、配色、材质、运动与镜头、转场，至少四项不同，并在项目方案中记录差异。这是制作者自检，工具不机械核对，也不作为审阅证据必需项。

## 导入边界

页面与风格共用白名单 html/js/mjs/css/json/svg/png/jpg/jpeg/webp/woff2/ttf/otf/md，最多 256 个文件、32 MiB（含说明与示例）。按相对路径及实际字节计算 SHA-256；拒绝符号链接、多硬链接、特殊文件、目录外引用和工作空间外路径。已存在副本只核对，不覆盖；使用前再次核对完整内容身份，篡改副本被拒绝。纯函数、说明栏目和美术效果由作者自检与观看确认。

## 制作者自检

交付前对当前编排中的页面图层使用两项工具，定位阅读时长、排版和画面不确定性问题：

- `clapgrid_check_page` 接收 `{segmentId, layerIndex?}`。`layerIndex` 是编排 `layers` 中的零基下标，省略时检查全部页面图层。页面可在 `render(t)` 后用 `window.TEXTS(t)` 返回当前可见文字及页面像素框 `[{text,x,y,width,height,id?}]`；同文案的不同元素宜用稳定的 `id` 区分。没有 `TEXTS` 时返回 `not-checked`。
  - 结果时间以图层起点为零，像素框以输出画面左上角为原点；连续几帧发生同类几何问题时报告首个问题框。
  - 检查文字是否停留足够、是否出框、是否挡住字幕。阅读时长阈值采用 opuscar 默认公式（汉字数 ÷ 4.5 + 其他字符数 ÷ 15 + 1.5 秒），尚待 ClapGrid 样片校准。字幕区域由当前导出字幕排版测得；缺少字体或字号时单独标为未检查。
  - 确定性检查比较少量局部时间在两个页面实例中按不同顺序渲染的像素，并对随机闪烁或跳帧给出警告；通过抽检不能证明所有帧都确定。
- `clapgrid_page_frames` 另外接收 `sampling: {times:[…]}` 或 `sampling: {from,to,interval}`，每次最多 60 帧。有多个页面图层时须指定 `layerIndex`。时间均为局部秒数，须在 `[0, DUR)` 内；区间从 `from` 采样至不超过 `to` 的最后一个等间隔时间点。按 1–2 秒间隔检查整体构图，按约 0.2 秒间隔观察关键动作。返回的 PNG 位于项目 `.cache/page-inspection/`，透明图层保留透明，文件可删除重建。

两项工具只用于制作者自检，结果不写入项目记录，也不是审阅证据。自检警告不会阻止片段合成预览或导出；需要留痕时，在交付说明中记下所查图层、发现的问题和修正结果。整句的字幕、构图和节奏仍以片段合成预览及实际看片为准。

## 片段合成预览

`clapgrid_preview_segment({ segmentId })` 受理真实合成，使用 `clapgrid_visual_previews` 查询终态；只有 `succeeded` 且 `current: true` 表示当前输入的可审阅结果，受理、缩略图或原件查看都不代表合成成功。任务期间沿用项目占用、取消、清理与中断恢复规则，取消使用 `clapgrid_cancel_export`。

片段合成预览和全片导出共用渲染器执行已保存编排，真实混合透明通道，短视频冻结末帧；缺失或过期编排明确失败。相关内容或编排变化后，旧预览显示待更新。
