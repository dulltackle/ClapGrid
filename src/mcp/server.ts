import { batchSchema } from '../shared/contracts.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { localServiceUrl, queryStatus, modifyBatch } from '../shared/client.js';

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
    description: '批量新增、修改或删除口播片段。修改/删除必须携带 clapgrid_status 查询得到的完整 expected 片段快照。用户编辑时立即拒绝；目标变化或删除逐项跳过。仅最终结果代表已提交，不自动重试。',
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
  return server;
}
