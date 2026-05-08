import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { getDatabase } from '../../db/index';
import { CitationsTable } from '../../tui/components/CitationsTable';
import type { CitationRow } from '../../tui/components/CitationsTable';

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List all citations')
    .action(() => {
      const db = getDatabase();
      const citations = db.getAllCitations();
      const rows: CitationRow[] = citations.map((citation) => ({
        doi: citation.doi,
        title: citation.title,
        year: citation.year,
        verificationStatus: citation.verificationStatus ?? 'unverified',
      }));
      render(<CitationsTable rows={rows} />);
    });
}
