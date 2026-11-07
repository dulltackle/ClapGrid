# 内置风格

风格是可跨项目复用、可执行的视觉语言。内置风格按 `<id>/STYLE.md`、`<id>/lib/`、`<id>/example/` 组织，整个目录随插件构建复制发布。示例视频放在文档或 Release 中链接，不进入插件包；本目录不预置测试风格或渲染好的示例片。首批美术风格见 [#281](https://github.com/dulltackle/ClapGrid/issues/281)。

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

说明固定包含：本质与“它不是什么”、材质与渲染、配色逻辑、字体（含字幕推荐字体与字号）、运动质感、镜头语法、转场、修改分级（放心改 / 一改就变味 / 不能改）。不含声音栏。风格不绘制字幕；项目按推荐设置统一导出字体与字号。

## lib/

ES module，只导出依赖 `t` 与传入参数的纯函数；每次绘制独立确定。纸纹、描边、镜头、缓动与转场都遵守这一约定。

## example/

包含 `index.html` 与 `page.json`，遵守[页面运行约定](../skills/open-clapgrid/references/composition.md#运行约定)。为避免内容摘要自引用，源示例的 `page.json` 与模块路径用 `STYLE_ID` 占位，导入后由使用者替换。示例 DUR 同步实际图层区间；图片、字体和模块在 READY 前就绪。
