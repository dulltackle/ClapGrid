import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { localServiceUrl, queryStatus } from '../shared/client.js';

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
  return server;
}
