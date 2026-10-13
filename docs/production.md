# 项目制作命令

统一入口是 `npm run production -- <命令> --project <项目根目录>`，也可直接调用 `node scripts/production.mjs`。入口共享简短摘要、完整 JSON 报告与退出状态。项目由工作空间决定，不按对话或 Git 分支另建项目身份。

```sh
node scripts/production.mjs check --project '/路径/中文 项目' --manifest production.json --report /tmp/production-report.json
```

`--manifest` 默认为项目根的 `production.json`，始终是项目相对路径；`--report` 是指定的报告路径，未指定时保存至项目 `logs/production/`。引用可含中文、空格；名称仅用于显示，路径始终来自显式映射。引用最终目标必须是项目内普通文件，越界路径或指向项目外的符号链接失败。

入口保留 `init`、`refs`、`check`、`evidence`、`sample`、`impact`、`pack`、`verify-package` 命令名；缺失的命令模块明确失败，不冒记已经实现。`--output` 和 `--archive` 相对项目根解析，供归档命令使用。`--` 后的参数通过 `options.args` 交给所属命令，所属命令决定并验证其含义。

## 清单与制作卡

`check` 的最小清单如下。尺寸、帧率、帧长、配音与素材角色来自当前项目；不以历史项目的参数作为默认标准。根层可增补证据、依赖和交付文件区域，其他命令验证自己的区域。

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

每个片段有唯一且稳定的 `id`。制作卡保留自由说明字段，并提供可机械核对的映射；组合卡可在 `segments` 中描述多个稳定片段，工具按 `id` 找到映射，不从显示名称猜文件名。

```json
{
  "说明": "此处记录内容、关键动作与审阅说明",
  "segments": [{ "id": "segment-A", "source": "src/动画.tsx", "audio": "audio/配音 A.wav" }]
}
```

清单与制作卡的源文件和配音映射必须一致。`typecheck` 指向项目的 TypeScript 配置，使用仓库锁定的编译器执行 `--noEmit --allowJs --checkJs --noCheck false --listFiles`，检查制作源文件确实进入编译范围，并为 JavaScript 制作源开启类型检查；项目配置不能用 `noCheck` 绕过检查。Remotion 等项目依赖仍由项目自己的锁定依赖安装提供。仓库中的命令模块另由 `tsconfig.production.json` 做严格 `checkJs` 类型检查。

## 媒体检查范围

检查依赖真实 `ffmpeg` 和 `ffprobe`。配音须有一条音轨且无视频轨；装配素材须有一条视频轨且无音轨；审阅素材须有一条视频轨与一条音轨。不接受其他未声明轨道。视频尺寸、实际帧率和完整计数的帧长须匹配清单。媒体容器时长与片段的帧长允许一个项目帧加 0.01 秒的编码差异，随后对全部轨道做完整解码；工具缺失或解码损坏均失败。

审阅音轨按源配音的实际采样率和声道数解码成 PCM，逐个声道样本比较，记录双方解码内容 SHA-256、样本数、采样参数与归一化误差。同时核对审阅音频与视频的轨道起始时间，只允许容器毫秒刻度加一个音频样本的量化余量，不能沿用一个视频帧的时长容差接受恢复延迟。缺少可核对的轨道起始时间明确失败。额外尾部按零填充源配音比较，允许正常静音补齐，不忽略追加声音。默认最大误差为 0.05；有明确编码容差时可指定 `project.audio.maxNormalizedError`（0 到 0.1），此设置不允许任意重新对齐音频。左右声道交换、恢复延迟、不同内容或过大时长差异不能通过。样本摘要不同但误差在已声明范围内可通过，报告保留实际差异。

离线通过只证明清单、制作类型、路径映射及文件媒体检查。它不证明配音输入快照仍有效、真实宿主装配或实际全片导出；报告将这些范围明确保留为本机待验收。可读性、动画效果、听审、领域判断与整体审美需要实际审阅，不能由有限帧取样或解码成功替代。

## 结果与现有验收链

命令返回 `status` 和 `checks`；每项包含 `id`、`status`、`message` 以及适用的失败路径和详细数据。入口补入项目、清单、时间与报告位置。只有非空的全部检查为 `passed` 时退出 0；失败、待审、跳过及未执行均退出非零。默认摘要只展示状态、检查数量、前三项失败位置及完整报告路径；受影响命令还显示 `affected` 范围。

指定的报告路径不能覆盖已有项目输入；发生写入失败时尝试将失败结果另存至项目日志目录，原输入保持不变。若备用报告也无法保存，终端明确报告失败并退出非零。

真实小型媒体回归位于 `tests/production.test.ts`，通过现有 `npm test` 运行；制作命令类型检查接入现有 `npm run typecheck`。`npm run check` 的既有 typecheck/test/build 阶段包含这两项，CI 仍安装媒体工具并通过 `npm run verify -- --revision <提交>` 执行完整正式验收，沿用原始日志和固定提交身份，不建立第二套全套执行器。开发定向回归不能替代指定提交的独立检出、`npm ci` 和完整检查。参见 [检查与正式验收](agents/verification.md)。

## 制作与交付导航

开始制作、局部修改或审阅时先读当前工作空间的 `video.md`，缺少时用 `init` 初始化，已有内容始终保留。用 `refs` 核对参考引用；公共长篇方法按项目需要读取。

批量制作前，先展示代表性动态样片并运行 [`sample`](production-sample.md)，把样片、采用方案、内容身份、用户来源和确认范围对应起来。`batchAllowed` 仅表示对应视觉方向门槛，不表示其它画面、发音、领域判断或完整成片终审已通过；项目既有终审仍需完成。受控测试不会获得实际批量许可。

修改输入后，通过 [`impact`](production-impact.md) 列出直接和间接受影响输出及原因；依赖或渲染参数基线缺失时补齐记录或扩大核对范围。重制后运行 `check` 并核对实际片段及相邻边界，再用 [`evidence`](production-evidence.md) 重新判断对应证据。未变内容与范围可显式复用，旧通过不能替代新否决或新内容审阅。

局部重制只更新受影响画面，最终继续使用既有 ClapGrid 全片导出。有效配音输入、实际素材关联和完整导出需要真实宿主观察，离线回归与文件检查分别记录。交付包通过 [`pack` 与 `verify-package`](production-package.md) 从实际清单生成、顺序校验及恢复核对，历史记录原样保留；包完整不代表人工要求已经通过。
