import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { getDatabase } from '../../db/index';
import { TrustScorer } from '../../scoring/scorer';
import { CitationsTable } from '../../tui/components/CitationsTable';
import type { CitationRow } from '../../tui/components/CitationsTable';

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List all citations with trust scores')
    .action(() => {
      const db = getDatabase();
      const scorer = new TrustScorer(db);
      const citations = db.getAllCitations();
      const rows: CitationRow[] = citations.map((c) => ({
        doi: c.doi,
        title: c.title,
        year: c.year,
        trustScore: c.trustScore ?? 0.5,
        trustLevel: scorer.getTrustLevel(c.trustScore ?? 0.5),
        verificationStatus: c.verificationStatus ?? 'unverified',
      }));
      render(<CitationsTable rows={rows} />);
    });
}
