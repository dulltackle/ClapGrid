import { batchSchema, segmentQuerySchema, scopedOperationSchema } from '../shared/contracts.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { localServiceUrl, queryStatus, modifyBatch, querySegments, processSegments } from '../shared/client.js';

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
    description: '批量新增、粘贴、修改、删除或重排口播片段。paste 按非空行创建片段；reorder 必须提供查询时项目顺序 expectedIds 及包含全部身份的新顺序 ids。修改/删除必须携带 clapgrid_status 查询得到的完整 expected 片段快照。用户编辑时立即拒绝；目标变化或删除逐项跳过。仅最终结果代表已提交，不自动重试。',
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
  return server;
}
