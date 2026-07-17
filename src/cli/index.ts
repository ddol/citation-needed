import { Command } from 'commander';
import { registerImportCommand } from './commands/import';
import { registerListCommand } from './commands/list';
import { registerDownloadCommand } from './commands/download';
import { registerServerCommand } from './commands/server';
import { registerAuthCommand } from './commands/auth';
import { registerIndexCommand } from './commands/index-corpus';
import { registerResetCommand } from './commands/reset';
import { registerCheckLocalPapersCommand } from './commands/check-local-papers';
import { registerExtractMarkdownCommand } from './commands/extract-markdown';
import { VERSION } from '../utils/version';

export function runCli(argv: string[]): void {
  const program = new Command();
  program
    .name('citation-needed')
    .description('Citation retrieval and Markdown extraction sidecar for AI agents')
    .version(VERSION);

  registerImportCommand(program);
  registerListCommand(program);
  registerDownloadCommand(program);
  registerServerCommand(program);
  registerAuthCommand(program);
  registerIndexCommand(program);
  registerResetCommand(program);
  registerCheckLocalPapersCommand(program);
  registerExtractMarkdownCommand(program);

  program.parse(argv);
}
