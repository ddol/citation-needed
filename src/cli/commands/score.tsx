import React from 'react';
import { render, Text } from 'ink';
import { Command } from 'commander';
import { getDatabase } from '../../db/index';
import { TrustScorer } from '../../scoring/scorer';
import { ScoreHistory } from '../../tui/components/ScoreHistory';

export function registerScoreCommand(program: Command): void {
  program
    .command('score <doi>')
    .description('Show trust score details for a citation')
    .action((doi: string) => {
      const db = getDatabase();
      const scorer = new TrustScorer(db);
      const citation = db.getCitation(doi);
      if (!citation) {
        render(<Text color="red">Citation not found: {doi}</Text>);
        return;
      }
      const score = citation.trustScore ?? 0.5;
      const trustLevel = scorer.getTrustLevel(score);
      const history = db.getTrustHistory(doi);
      render(
        <ScoreHistory doi={doi} score={score} trustLevel={trustLevel} history={history} />
      );
    });
}
