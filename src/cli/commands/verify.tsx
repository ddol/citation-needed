import React from 'react';
import { render, Box, Text } from 'ink';
import { Command } from 'commander';
import { getDatabase } from '../../db/index';
import { ClaimVerifier } from '../../verification/verifier';

export function registerVerifyCommand(program: Command): void {
  program
    .command('verify <doi> <claim>')
    .description('Verify a claim against a citation PDF')
    .action(async (doi: string, claim: string) => {
      const db = getDatabase();
      const citation = db.getCitation(doi);
      if (!citation) {
        render(<Text color="red">Citation not found: {doi}</Text>);
        return;
      }

      const verifier = new ClaimVerifier();
      const result = await verifier.verify(doi, claim, { pdfPath: citation.pdfPath });
      const status = result.verified ? 'verified' : result.pdfAvailable ? 'failed' : 'unverified';
      db.updateVerificationStatus(doi, status);

      render(
        <Box flexDirection="column">
          <Text>
            Verified: <Text color={result.verified ? 'green' : 'red'}>{result.verified ? 'YES' : 'NO'}</Text>
          </Text>
          <Text>
            Matched keywords: {result.matchedKeywords.length}/{result.totalKeywords}
          </Text>
          {result.matchedKeywords.length > 0 && (
            <Text>Matches: {result.matchedKeywords.join(', ')}</Text>
          )}
          <Text dimColor>{result.notes}</Text>
        </Box>
      );
    });
}
