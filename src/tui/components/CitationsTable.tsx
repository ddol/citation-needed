import React from 'react';
import { Box, Text } from 'ink';

export interface CitationRow {
  doi: string;
  title?: string;
  year?: number;
  trustScore: number;
  trustLevel: string;
  verificationStatus: string;
}

export function CitationsTable({ rows }: { rows: CitationRow[] }): React.ReactElement {
  if (rows.length === 0) {
    return (
      <Text color="yellow">
        {'No citations found. Import some with: citation-needed import-bibtex <file>'}
      </Text>
    );
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="cyan">{'DOI'.padEnd(30)}</Text>
        <Text bold color="cyan">{'Title'.padEnd(40)}</Text>
        <Text bold color="cyan">{'Year'.padEnd(6)}</Text>
        <Text bold color="cyan">{'Trust'.padEnd(8)}</Text>
        <Text bold color="cyan">{'Status'}</Text>
      </Box>
      {rows.map((row) => (
        <Box key={row.doi}>
          <Text>{(row.doi || '').slice(0, 29).padEnd(30)}</Text>
          <Text>{(row.title || '(no title)').slice(0, 39).padEnd(40)}</Text>
          <Text>{String(row.year || '').padEnd(6)}</Text>
          <Box width={8}>
            <TrustBadgeInline score={row.trustScore} />
          </Box>
          <Text dimColor>{row.verificationStatus}</Text>
        </Box>
      ))}
    </Box>
  );
}

function TrustBadgeInline({ score }: { score: number }): React.ReactElement {
  const color = score >= 0.7 ? 'green' : score >= 0.4 ? 'yellow' : 'red';
  return <Text color={color}>{score.toFixed(2)}</Text>;
}
