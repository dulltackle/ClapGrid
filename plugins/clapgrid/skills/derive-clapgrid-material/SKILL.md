---
name: derive-clapgrid-material
description: 为 ClapGrid 片段生成插图、编辑已有图片或抠出透明主体时，确认生图计划，调用 Codex imagegen，再带派生来源导入当前项目。
---

1. 用 `clapgrid_status` 核对当前项目、目标片段和输入素材 ID。批量生成前逐项列出目标片段、每张图的派生方式和总张数，等用户确认后再调用 `imagegen`。用户明确请求单张图片即视为确认。一次生图约消耗普通回合 3–5 倍的额度。
2. 抠图用 `matte`，将 `transparent_background` 设为 `true`。编辑或抠图时，用 `referenced_image_paths` 传入输入素材的项目原件绝对路径，最多 5 张。对已核对的图片，从状态快照的 `storage.mediaDirectory` 取目录，原件为 `<素材 ID>.source`。如果工具要求图片扩展名，按素材的 MIME 类型复制一份带 `.png` 或 `.jpg` 后缀的临时文件。纯文字生图用 `generate`，编辑用 `edit`。若工具失败或结果不明，报告并等待用户决定，禁止自动重试。
3. 使用 `imagegen` 本次返回的 `savedPath` 调用 `clapgrid_import_material`。附上 `derivation`，填写 `method`、`executor`（Codex 生图填 `codex-imagegen`）、实际使用的 `model`（例如 `gpt-image-2`）、`prompt` 及本次直接输入的素材 ID 列表 `inputs`。纯文字生图的 `inputs` 填空数组。时间由服务端记录。如果服务明确拒绝读取该路径，可将同一输出文件复制到当前工作区后导入，无需再次生图。若导入结果不明，先报告并等待用户决定。
4. 核对返回的素材 ID 和派生来源。告诉用户生成图片仅作示意，医学准确性须人工审阅，生成图片不能作为医学依据。
