import { submitSpeechSchema, voiceSchema, importVideoSchema, batchSchema, segmentQuerySchema, scopedOperationSchema } from '../shared/contracts.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { localServiceUrl, querySpeech, submitSpeech, setVoice, queryStatus, importVideo, modifyBatch, querySegments, processSegments } from '../shared/client.js';

export function createBusinessMcp(url: string) {
  const baseUrl = localServiceUrl(url);
  const server = new McpServer({ name: 'clapgrid', version: '0.1.0' });
  server.registerTool('clapgrid_status', {
    description: '查询 ClapGrid 独立本地服务及当前项目状态。仅查询，不启动服务或修改业务状态。',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    try {
      const status = await queryStatus(baseUrl);
      return { content: [{ type: 'text', text: JSON.stringify(status) }], structuredContent: status };
    } catch {
      return { isError: true, content: [{ type: 'text', text: `ClapGrid 服务不可用或身份不匹配（${baseUrl}）。请通过插件入口经宿主允许启动服务后重试。` }] };
    }
  });
  server.registerTool('clapgrid_modify', {
    description: '批量新增、粘贴、修改、删除或重排口播片段，或设置视频关联。video 操作携带完整 expected、assetId 和 start（秒）；assetId 为 null 解除关联，否则关联/替换已导入素材并设置起点，使用同一 assetId 可只调整起点。paste 按非空行创建片段；reorder 必须提供查询时项目顺序 expectedIds 及包含全部身份的新顺序 ids。修改/删除必须携带 clapgrid_status 查询得到的完整 expected 片段快照。用户编辑时立即拒绝；目标变化或删除逐项跳过。仅最终结果代表已提交，不自动重试。',
    inputSchema: batchSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async (input, extra) => {
    try {
      const result = await modifyBatch(baseUrl, input, extra.signal);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : '修改失败，结果未知，请查询项目；不会自动重试。' }] };
    }
  });
  server.registerTool('clapgrid_query_segments', {
    description: '按 all、明确 ids、文案包含条件 query 或表格当前勾选 selected 查询片段。返回项目顺序、稳定身份及已连接表格的勾选。selected 没有选择/已断开返回 unavailable；多个表格需指定 tableId，否则 ambiguous。不会扩大为全项目。',
    inputSchema: segmentQuerySchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async input => {
    try {
      const result = await querySegments(baseUrl, input.scope);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : '查询失败' }] };
    }
  });
  server.registerTool('clapgrid_process_segments', {
    description: '按明确范围修改文案或删除片段。必须携带查询得到的 expected 片段快照；提交时固定目标，后续勾选变化不影响操作。空选择/断开拒绝，新增勾选未查询过则拒绝；内容过时逐项跳过。不会自动扩大范围或重试。',
    inputSchema: scopedOperationSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async (input, extra) => {
    try {
      const result = await processSegments(baseUrl, input, extra.signal);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : '修改失败，请查询项目确认结果' }] };
    }
  });
  server.registerTool('clapgrid_import_video', {
    description: '导入用户明确指定的单个本地视频绝对路径（可在项目外），复制原件到项目并生成静音预览与缩略图。只能传入用户已授权的具体来源，不扫描或猜测路径。持有普通修改权直至完成；返回素材身份供多个片段复用。失败不自动重试。',
    inputSchema: importVideoSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (input, extra) => {
    try {
      const result = await importVideo(baseUrl, input.sourcePath, undefined, extra.signal);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : '导入失败，请查询项目确认结果' }] };
    }
  });
  server.registerTool('clapgrid_submit_speech', {
    description: '为一个明确片段生成配音，文案发送至 TokenDance seed-tts-2.0。一次操作固定 UUID requestId；重发必须复用，仅明确的新操作使用新标识。返回已受理不代表成功。生成期间项目锁定；不会自动重试。',
    inputSchema: submitSpeechSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async input => {
    try { const result = await submitSpeech(baseUrl, input); return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: (error as Error).message }] }; }
  });
  server.registerTool('clapgrid_speech_status', {
    description: '查询配音任务标识、请求标识、输入快照、进度和结果、完整音频试听路径，以及统一声音和凭据是否配置；不回显密钥。',
    inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    try { const result = await querySpeech(baseUrl); return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: { ...result } }; }
    catch { return { isError: true, content: [{ type: 'text', text: '配音状态查询失败，请检查本地服务' }] }; }
  });
  server.registerTool('clapgrid_set_voice', {
    description: '保存项目统一音色和语速（speechRate 整数 -50 至 100，0 为原速）。无逐片段覆盖或高级参数；不自动生成配音。编辑占用或任务锁期间拒绝。',
    inputSchema: voiceSchema, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async input => {
    try { const result = await setVoice(baseUrl, input); return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: (error as Error).message }] }; }
  });
  return server;
}
