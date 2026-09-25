# Seed TTS 2.0 一次性试听原型

这是用于声音选择的讨论资产，不是产品实现。决策事项：
https://github.com/dulltackle/ClapGrid/issues/9

2026-09-25 通过 TokenDance 完成三次真实合成，均收到成功完成标志。
三段音频使用相同文案、原速、默认音量，格式为 24 kHz 单声道 MP3。

| 样例 | 音色 | 时长 |
| --- | --- | --- |
| A-vivi.mp3 | vivi 2.0 | 20.064 秒 |
| B-fluent.mp3 | 流畅女声 | 20.280 秒 |
| C-yichen.mp3 | 儒雅逸辰 | 20.064 秒 |

用户选择 A，保持原速，反馈数字、英文和停顿均自然，没有别扭之处。
最终确认首版可选上述三种音色，默认 A，可调项目统一语速；音量固定，不开放情绪、音调等高级参数。

直接播放已有 MP3 即可试听，无需再次调用 API。
如确需重新生成，在运行目录的 `.env` 设置 `TOKENDANCE_KEY`，然后运行：

```bash
python3 prototypes/seed-tts-audition/generate.py
```

该命令会发起三次可能计费的请求并覆盖原型目录同名输出，不自动重试。密钥不包含在归档中。脚本仅供复现本次实验，不是生产客户端。

`manifest.json` 保存文案、音色 ID、参数及返回的用量信息。每次接口返回 `text_words: 102`，未核对实际扣费。

来源：
- https://tokendance.space/models/seed-tts-2.0
- https://tokendance.space/docs/protocol-ark-tts.md
- https://www.volcengine.com/docs/6561/162929?lang=en
