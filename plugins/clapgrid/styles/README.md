# 内置风格

风格是可跨项目复用、可执行的视觉语言。内置风格按 `<id>/STYLE.md`、`<id>/lib/`（含 `subtitle.js`）、`<id>/example/` 组织，整个目录随插件构建复制发布。本目录随包提供风格与示例源码，示例视频可从仓库观看。[内置风格示例片](https://github.com/dulltackle/ClapGrid/blob/main/README.md#内置风格示例)

本页约定如何编写风格；项目选用、导入、页面引用与导入边界见[画面编排制作约定](../skills/open-clapgrid/references/composition.md#风格)。

## STYLE.md

使用以下头部。项目复制后追加 `source`，保留项目版本自己的 id 与 version：

```yaml
---
id: project-style
version: "1"
source:
  id: builtin-id
  version: "1"
---
```

说明固定包含：本质与“它不是什么”、材质与渲染、配色逻辑、字体与字幕（说明字幕的字体、排版及出场方式）、运动质感、镜头语法、转场、修改分级（放心改 / 一改就变味 / 不能改）。不含声音栏。风格自带字体可用 woff2 等文件随风格分发。

## lib/

ES module。纸纹、描边、镜头、缓动、转场与字幕均按时间和传入参数独立确定绘制结果。

### 字幕模块

`lib/subtitle.js` 须导出以下两项：

- `subtitleRegion` 是固定矩形 `{ x, y, width, height }`，单位为 1920×1080 画布像素，宽高为正且矩形完整落在画布内。页面画面自检用它判断文字遮挡。
- `drawSubtitle(ctx, text, t, duration)` 在透明 Canvas 2D 上绘制当前帧。`text` 是完整文案，`t` 从片段起点计时，`duration` 是片段的配音时长，单位均为秒。宿主每帧清空画布并重置绘制状态。绘制函数自行处理排版、换行与出场效果。可在模块初始化时用 `FontFace.load()` 加载同目录字体并注册到 `document.fonts`。

字幕会覆盖整个片段，并叠在所有画面图层上方。仅文案变化且画面区间、素材和项目风格相同时，复用已渲染的页面图层。配音仍需对应新文案。渲染缓存位于项目的 `.cache/rendered-layers/`，项目空闲时可清理，后续任务会重建。模块导出非法时，渲染任务报告出错片段。

## example/

包含 `index.html`，遵守[页面运行约定](../skills/open-clapgrid/references/composition.md#运行约定)，使用 `/style/lib/` 引用模块。示例 DUR 同步实际图层区间；图片、字体和模块在 READY 前就绪。
