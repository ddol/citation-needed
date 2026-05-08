import React from 'react';
import { render, Box, Text } from 'ink';
import { Command } from 'commander';
import { processBibtexFile } from '../../workflows/process-bibtex';

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
        const result = await processBibtexFile(file, options);

        render(
          <Box flexDirection="column">
            <Text color="green">Processed BibTeX file: {result.bibtexPath}</Text>
            <Text>Imported citations: {result.importedCount}</Text>
            <Text>Downloaded PDFs: {result.downloadedCount}</Text>
            <Text>Generated Markdown files: {result.markdownCount}</Text>
            <Text>Skipped entries without DOI: {result.skippedCount}</Text>
            <Text>PDF output: {result.paperPath}</Text>
            <Text>Markdown output: {result.markdownPath}</Text>
            {result.failures.length > 0 && (
              <Box flexDirection="column">
                <Text color="yellow">Failures:</Text>
                {result.failures.map((failure) => (
                  <Text key={`${failure.doi}-${failure.stage}`} dimColor>
                    {failure.doi} [{failure.stage}] {failure.message}
                  </Text>
                ))}
              </Box>
            )}
          </Box>
        );
      }
    );
}
