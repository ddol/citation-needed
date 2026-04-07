import React from 'react';
import { render, Box, Text } from 'ink';
import { Command } from 'commander';
import { getDatabase } from '../../db/index';
import { TrustScorer } from '../../scoring/scorer';
import { extractPdfText } from '../../verification/extractor';

export function registerVerifyCommand(program: Command): void {
  program
    .command('verify <doi> <claim>')
    .description('Verify a claim against a citation PDF')
    .action(async (doi: string, claim: string) => {
      const db = getDatabase();
      const scorer = new TrustScorer(db);

      // Load PDF text from stored path if available
      const citation = db.getCitation(doi);
      let pdfContent: string | undefined;
      if (citation?.pdfPath) {
        try {
          pdfContent = await extractPdfText(citation.pdfPath);
        } catch {
          // Fall through to title-based heuristic
        }
      }

      const result = await scorer.verifyAndScore(doi, claim, pdfContent);
      const color = result.verified ? 'green' : 'red';
      render(
        <Box flexDirection="column">
          <Text>
            Verified: <Text color={color}>{result.verified ? 'YES' : 'NO'}</Text>
          </Text>
          <Text>Score: {result.score.toFixed(3)}</Text>
          <Text dimColor>{result.notes}</Text>
        </Box>
      );
    });
}
