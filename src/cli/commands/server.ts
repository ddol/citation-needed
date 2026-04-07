import { Command } from 'commander';
import { startMcpServer } from '../../mcp/server';

export function registerServerCommand(program: Command): void {
  program
    .command('server')
    .description('Start the MCP server')
    .action(async () => {
      await startMcpServer();
    });
}
