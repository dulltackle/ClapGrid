# 制作依赖与局部重制

```sh
node scripts/production.mjs impact --project '/项目/中文 路径' --report /tmp/impact-report.json
```

入口及基础清单见[项目制作命令](production.md)。`impact` 只读取并核对已声明的制作关系，不会重制、改写清单、购买配音、生图或自动导出。受影响范围用来指导局部画面重制，最终继续使用现有 ClapGrid 完整导出。

## 记录实际使用的关系

`production.json` 的 `dependencies` 包含 `complete`、`renderInputs` 和 `nodes`。只有已核对实际使用关系后才能声明 `complete:true`；工具无法从任意制作程序自动推断运行时依赖，清单结构核对不能代替记录者检查实际消费关系。

每个节点对应项目内一个普通文件，保存稳定 `id`、真实 `path`、制作时的 `sha256`、`kind`、`dependsOn`（直接消费的节点 ID），以及适用的稳定口播片段 `segmentId`。共享源或素材可以不绑定单个片段；一个文件只登记一个节点。不得用行号、显示名称或文件排序推断身份。

```json
{
  "id": "B-transition",
  "path": "outputs/B转场.mkv",
  "sha256": "这里填写实际文件的64位小写SHA256",
  "kind": "transition",
  "segmentId": "B",
  "dependsOn": ["A-last-frame"]
}
```

| kind | 含义与必要关系 |
| --- | --- |
| source | 制作源文件；共享源可由多个输出消费 |
| card | 制作卡；被渲染读取时记录到实际消费者，不把仅供说明的文档强行关联到画面 |
| audio | 实际配音输入；审阅输出必须关联对应配音 |
| asset | 实际使用的共享图片等素材 |
| assembly | 无音轨画面装配；必须关联对应制作源和声明的素材 |
| review | 审阅素材；必须关联对应装配与配音 |
| last-frame | 从实际片段输出取得的末帧；必须关联对应装配 |
| transition | 转场输出；必须被所属片段的实际装配消费 |

额外消费的图片在片段 `assets` 中列出，实际末帧在 `lastFrame` 中声明，转场在 `transitions` 中列出。

例如 A 的画面源 → A 装配 → A 末帧 → B 转场 → B 装配 → B 审阅。A 修改后，即使尚未重制的 B 文件摘要未变，也必须核对 B；与这次画面变化无关的 C 和配音保持可复用。

## 渲染参数基线

文件摘要不能发现只改尺寸或帧长的情况，`dependencies.renderInputs` 保存制作该批输出时的渲染输入（数值仅为示例）：

```json
{
  "width": 1280,
  "height": 720,
  "fps": 25,
  "segments": [{ "id": "A", "frames": 50 }, { "id": "B", "frames": 60 }]
}
```

`video.md`、证据说明及其他无关文字不进入这个基线。摘要与参数基线代表已核对的制作版本，不应为了消除待核对状态直接替换成当前值：先完成实际重制、媒体检查、边界核对及适用的确认，再更新基线。

## 使用报告

`affected.outputs` 列出需要重制或重新核对的画面输出，`affected.segments` 列出稳定片段范围，每项附 `causeIds` 和 `reasonChains`。受影响输出为 `pending` 并退出非零；图不完整为 `failed`。项目声明 `evidence` 时，受影响输入对应的旧通过记录降为待重新核对，原始记录保留；依赖核对通过不代表人工确认通过。
