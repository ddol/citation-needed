import { Command } from 'commander';
import { getDatabase } from '../../db/index';
import type { CitationRow } from '../citations-table';
import { formatCitationsTable } from '../citations-table';
import { print } from '../output';

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List all citations')
    .action(() => {
      const db = getDatabase();
      const rows: CitationRow[] = db.getAllCitations().map((citation) => ({
        doi: citation.doi,
        title: citation.title,
        year: citation.year,
        verificationStatus: citation.verificationStatus ?? 'unverified',
      }));
      print(...formatCitationsTable(rows));
    });
}
