import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBusinessMcp } from './server.js';

const server = createBusinessMcp(process.env.CLAPGRID_SERVICE_URL ?? 'http://127.0.0.1:48762');
await server.connect(new StdioServerTransport());
