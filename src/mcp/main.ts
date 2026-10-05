import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBusinessMcp } from './server.js';

const server = createBusinessMcp();
await server.connect(new StdioServerTransport());
