import { Command } from 'commander';
import { registerImportCommand } from './commands/import';
import { registerListCommand } from './commands/list';
import { registerDownloadCommand } from './commands/download';
import { registerServerCommand } from './commands/server';
import { registerAuthCommand } from './commands/auth';

export function runCli(argv: string[]): void {
  const program = new Command();
  program
    .name('citation-needed')
    .description('Citation retrieval and Markdown extraction sidecar for AI agents')
    .version('0.1.0');

  registerImportCommand(program);
  registerListCommand(program);
  registerDownloadCommand(program);
  registerServerCommand(program);
  registerAuthCommand(program);

  program.parse(argv);
}
