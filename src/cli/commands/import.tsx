import React from 'react';
import fs from 'fs';
import { render, Text } from 'ink';
import { Command } from 'commander';
import { getDatabase } from '../../db/index';
import { parseBibtex } from '../../parsers/bibtex';

export function registerImportCommand(program: Command): void {
  program
    .command('import-bibtex <file>')
    .description('Import citations from a BibTeX file')
    .action((file: string) => {
      const db = getDatabase();
      const content = fs.readFileSync(file, 'utf-8');
      const parsed = parseBibtex(content);
      let count = 0;
      for (const entry of parsed) {
        if (entry.doi) {
          db.addCitation({ ...entry, doi: entry.doi });
          count++;
        }
      }
      render(<Text color="green">Imported {count} citations from {file}</Text>);
    });
}
