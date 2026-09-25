# 首版在线中文配音服务接入调查

查询日期：2026-09-21。对应事项：[调查首版在线中文配音服务的接入选择](https://github.com/dulltackle/ClapGrid/issues/3)。本报告只核实官方文档，没有发送付费请求或开展试听；候选推荐不是已确定的产品决策。

## 结论

建议下一轮优先试听 **MiniMax speech-2.8-hd 与 Azure 的标准中文神经声音**；如果已有可用 OpenAI API 账户，也可将 gpt-4o-mini-tts 纳入试听。这个排序是对中文配置、接入复杂度与价格可理解性的判断，并非音质排名。

项目只有 20～30 个口播片段，建议一个片段对应一次普通配音请求，由本地队列管理批量操作、失败重试和持久化。无需因“批量生成”引入供应商的长文本异步服务。输出 16:9、1080p MP4 是本地粗剪阶段的约束，不要求配音供应商直接返回 MP4。

## 候选比较

| 候选 | 中文和声音 | 调用、格式及限制 | 用户接入 |
| --- | --- | --- | --- |
| MiniMax speech-2.8-hd / turbo | 有 voice_id、中文增强选项及普通话发音替换；文档示例提供内置声音 | 同步 HTTP 可非流式；文本少于 10,000 字符；示例输出 MP3，非流式说明包含 WAV/FLAC；音频可返回 hex 或 24 小时有效 URL | 普通 API Key 通过 Bearer 传入 |
| Azure Speech 标准中文神经声音 | 可选 zh-CN-XiaoxiaoNeural、zh-CN-YunxiNeural 等；可按区域查询实际声音列表 | REST 请求发送 SSML，响应为音频；支持 WAV/PCM 和 MP3 等；单次输出最多 10 分钟，超过会截断 | 创建 Speech 资源，配置对应区域/端点及资源 Key |
| OpenAI gpt-4o-mini-tts | 支持中文；官方指出内置声音针对英语优化，故中文自然度必须试听 | /audio/speech 返回音频内容或流；支持 MP3、WAV、PCM、AAC、FLAC、Opus；API input 最多 4096 字符，同时模型最多 2000 输入 tokens | 用户自己的 API Key，通过 Bearer 传入 |

来源：[MiniMax 同步接口](https://platform.minimax.cn/docs/api-reference/speech-t2a-http)、[Azure REST 接口](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech)、[Azure 声音列表](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts)、[OpenAI 语音指南](https://developers.openai.com/api/docs/guides/text-to-speech)、[OpenAI 接口](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)、[OpenAI 模型](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts)。

Azure F0 为每 60 秒 20 次请求，S0 标准声音默认每秒 30 次。30 个片段也可能触发免费档限流；文档还指出部分 429 来自区域内特定声音容量，而非账户配额。因此本地批量队列需节流，不能同时发出所有请求。[Azure 配额](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits)

## 价格与可估算程度

- **MiniMax 中国平台普通按量计费**：speech-2.8-hd 为 3.50 元/万计费字符，turbo 为 2.00 元/万计费字符。一个汉字算两个字符，标点、空格等各算一个。假设文案为 1000 个汉字、忽略标点且每句只生成一次，估算分别为 0.70 元、0.40 元；这只是按已注明假设计算，不是实际项目报价。异步长文本提供同档单价及最大 100 万字符能力，当前规模用不上。[官方价格](https://platform.minimax.cn/docs/guides/pricing-paygo)
- **Azure**：神经配音 F0 每月 50 万字符免费，付费按字符计费。但本次公开价格页的具体付费价格显示为 `$-`，需在用户选定地区、币种和资源后核实，不能据记忆补一个单价，也不能把 F0 配额当成 S0 免费额度。[官方价格页](https://azure.microsoft.com/en-us/pricing/details/speech/)
- **OpenAI**：模型页列出文本输入 0.60 美元/百万 tokens、音频输出 12 美元/百万 tokens。计费单位与 MiniMax 字符不同，不能按同一个“千字成本”直接比较；以实际生成用量为准。[官方模型价格](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts)

## 失败与重试语义

| 服务 | 官方可确认的错误区分 | 对实现的建议 |
| --- | --- | --- |
| MiniMax | 1001 超时、1002 限流、1024 内部错误建议稍后重试；1004/2049 密钥错误、1008 余额不足、2013 参数错误需处理原因 | 除 HTTP 状态外检查 base_resp.status_code，并验证 data.audio 存在；保存 trace_id |
| Azure | 401 身份错误、400/415 输入或类型错误、429 限流、502/503 服务问题 | 只对临时错误有限重试；持续 429 检查区域和声音容量 |
| OpenAI | 429 可能是限流，也可能余额/预算耗尽；500/503 可稍后重试；存在 Retry-After 时遵守 | 按 error.code 区分“稍后再试”与“需要用户处理”，指数退避加抖动并限制次数 |

来源：[MiniMax 错误码](https://platform.minimax.cn/docs/api-reference/errorcode)、[MiniMax 响应结构](https://platform.minimax.cn/docs/api-reference/speech-t2a-http)、[Azure REST 状态码](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech)、[Azure 配额与容量](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits)、[OpenAI 错误码](https://developers.openai.com/api/docs/guides/error-codes)。

本次查阅的同步端点资料没有建立“相同请求重试绝不重复收费”的保证。因此不要把超时当成供应商一定没生成。建议将请求参数与本地任务状态持久化，成功结果原子落盘，重试仅针对失败项；成功项默认复用。对于已发出但响应丢失的请求，在界面区分结果未知，重试可能新增调用费用。以上是应用侧设计建议，不是供应商承诺。

## 对后续规格的输入

1. 配音结果记录片段身份、文案快照、供应商、模型、voice_id、生成参数和文件路径；回包时比较当前输入，旧结果保留但标记过期。
2. 接口保持小：输入文案及项目声音配置，输出本地可播放音频、实际时长、请求标识和可得的计费用量。不把供应商字幕能力列为首版依赖。
3. 优先请求 WAV 或接收后统一解码为剪辑所需音频；实际时长以完整音频解码/探测为准。不要用文字长度预测时长决定粗剪。
4. 密钥留在本地运行服务的凭据配置，项目只记录凭据引用；不要写入可复制的项目素材、文档或日志。具体凭据存储机制由运行边界决策确定。

这四项是供后续决策讨论的建议，尚未替用户锁定。

## 仍需与用户确定

- 账户与所在地区能否直接使用候选，是否已有充值账户；Azure 具体地区的付费价格。
- 使用同一份 5～10 句样稿试听，覆盖数字、日期、英文缩写、多音字及相邻句停顿；关注每句独立生成后拼接是否自然。
- 确认唯一首发供应商与项目默认声音。首版不需要同时接入三家，不需要声音克隆。
- 确认结果未知的重试提示和预算展示。未做实测前，不承诺端到端延迟、中文听感或稳定性。
