# 项目制作命令

统一入口是 `npm run production -- <命令> --project <项目根目录>`，也可直接调用 `node scripts/production.mjs`；命令为 `init`、`refs`、`check`、`evidence`、`sample`、`impact`、`pack`、`verify-package`。项目由工作空间决定，不按对话或 Git 分支另建项目身份。日常制作和相关检查只需 Node；`check` 与 `sample` 另需真实 FFmpeg、ffprobe 及项目自己的制作依赖。

```sh
node scripts/production.mjs check --project '/路径/中文 项目' --manifest production.json --report /tmp/production-report.json
```

`--manifest` 默认为项目根的 `production.json`；`--report` 未指定时保存至项目 `logs/production/`。只有全部检查为 `passed` 时退出 0；失败、待审、跳过及未执行均退出非零。

## 清单与制作卡

`check` 的最小清单如下。尺寸、帧率、帧长、配音与素材角色按当前项目填写，不以历史项目的参数作为默认标准。

```json
{
  "schemaVersion": 1,
  "project": { "width": 1280, "height": 720, "fps": 25 },
  "typecheck": "tsconfig.json",
  "segments": [{
    "id": "segment-A",
    "name": "组合片段的显示名称",
    "card": "cards/组合制作卡.json",
    "source": "src/动画.tsx",
    "audio": "audio/配音 A.wav",
    "frames": 50,
    "assembly": "outputs/装配 A.mp4",
    "review": "outputs/审阅 A.mp4"
  }]
}
```

每个片段有唯一且稳定的 `id`；工具按 `id` 找映射，不从显示名称猜文件名。路径始终是项目内相对路径，名称仅用于显示。制作卡保留自由说明字段，并提供可机械核对的映射，必须与清单一致：

```json
{
  "说明": "此处记录内容、关键动作与审阅说明",
  "segments": [{ "id": "segment-A", "source": "src/动画.tsx", "audio": "audio/配音 A.wav" }]
}
```

`typecheck` 指向项目的 TypeScript 配置，制作源须进入编译范围，项目配置不能用 `noCheck` 绕过检查。配音为纯音轨，装配素材为无音轨视频，审阅素材含一条视频与一条音轨。审阅音频与源配音按样本比较，默认最大归一化误差 0.05；有明确编码容差时可指定 `project.audio.maxNormalizedError`（0 到 0.1），该设置不允许任意重新对齐音频。

## 检查边界

离线通过只证明清单、制作类型、路径映射及文件媒体检查，不证明配音输入快照仍有效、真实宿主装配或实际全片导出；可读性、动画效果、听审、领域判断与整体审美需要实际审阅，不能由有限帧取样或解码成功替代。

## 制作与交付导航

开始制作、局部修改或审阅时先读当前工作空间的 `video.md`，缺少时用 `init` 从[模板](templates/video.md)初始化，已有内容始终保留。用 `refs` 核对参考引用。

批量制作前，先展示代表性动态样片并运行 [`sample`](production-sample.md)。修改输入后，通过 [`impact`](production-impact.md) 列出受影响输出；重制后运行 `check` 并核对实际片段及相邻边界，再用 [`evidence`](production-evidence.md) 重新判断对应证据。旧通过不能替代新否决或新内容审阅。

局部重制只更新受影响画面，最终继续使用既有 ClapGrid 全片导出。交付包通过 [`pack` 与 `verify-package`](production-package.md) 生成与核对；包完整不代表人工要求已经通过。
