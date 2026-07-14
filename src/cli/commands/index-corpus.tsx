import React from 'react';
import { render, Text } from 'ink';
import { Command } from 'commander';
import { getDatabase } from '../../db/index';
import { IndexService } from '../../services/indexer';

export function registerIndexCommand(program: Command): void {
  program
    .command('index')
    .description('Index extracted Markdown into the full-text search tables (idempotent)')
    .action(async () => {
      const summary = await new IndexService(getDatabase()).indexCorpus();
      const line =
        `Indexed ${summary.indexed} citation(s); ${summary.unchanged} unchanged; ` +
        `${summary.missingMarkdown} without extracted Markdown; ${summary.scanned} scanned.`;

      if (summary.errors.length > 0) {
        const failures = summary.errors.map((e) => `${e.doi}: ${e.message}`).join('; ');
        render(
          <Text color="red">
            {line} Failures: {failures}
          </Text>
        );
        process.exitCode = 1;
      } else {
        render(<Text color="green">{line}</Text>);
      }
    });
}
