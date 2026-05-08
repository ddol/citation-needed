import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { ImportProgress } from '../../tui/components/ImportProgress';

export function registerImportCommand(program: Command): void {
  program
    .command('import-bibtex <file>')
    .description('Import a BibTeX file, download PDFs, and write Markdown output')
    .option('--paper-path <path>', 'Directory for downloaded PDFs')
    .option('--markdown-path <path>', 'Directory for generated Markdown files')
    .option('--email <email>', 'Email for Unpaywall API lookups')
    .action(
      async (
        file: string,
        options: { paperPath?: string; markdownPath?: string; email?: string }
      ) => {
        const instance = render(<ImportProgress bibtexPath={file} options={options} />);
        await instance.waitUntilExit();
      }
    );
}
