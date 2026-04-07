#!/usr/bin/env node
import { runCli } from './cli/index';
import { startMcpServer } from './mcp/server';

const args = process.argv.slice(2);

if (args[0] === 'server') {
  startMcpServer().catch((err) => {
    process.stderr.write(`MCP server error: ${err}\n`);
    process.exit(1);
  });
} else {
  runCli(process.argv);
}
