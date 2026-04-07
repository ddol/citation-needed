#!/usr/bin/env node
import { runCli } from './cli/app';
import { startMcpServer } from './server/mcp';

const args = process.argv.slice(2);

if (args[0] === 'server') {
  startMcpServer().catch((err) => {
    console.error('MCP server error:', err);
    process.exit(1);
  });
} else {
  runCli(process.argv);
}
