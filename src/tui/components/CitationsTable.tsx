import React from 'react';
import { Box, Text, useStdout } from 'ink';

export interface CitationRow {
  doi: string;
  title?: string;
  year?: number;
  verificationStatus: string;
}

interface ColumnWidths {
  doi: number;
  title: number;
  year: number;
  status: number;
}

const DEFAULT_TERMINAL_WIDTH = 120;
const MIN_TITLE_WIDTH = 20;

function computeWidths(terminalWidth: number): ColumnWidths {
  const doiWidth = 30;
  const yearWidth = 6;
  const statusWidth = 12;
  // 3 single-space gutters between four columns
  const remainder = Math.max(
    terminalWidth - doiWidth - yearWidth - statusWidth - 3,
    MIN_TITLE_WIDTH
  );
  return { doi: doiWidth, year: yearWidth, status: statusWidth, title: remainder };
}

function statusColor(status: string): 'green' | 'yellow' | 'red' | 'gray' {
  switch (status) {
    case 'verified':
    case 'downloaded':
      return 'green';
    case 'failed':
    case 'not-found':
      return 'red';
    case 'unverified':
      return 'yellow';
    default:
      return 'gray';
  }
}

export function CitationsTable({ rows }: { rows: CitationRow[] }): React.ReactElement {
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? DEFAULT_TERMINAL_WIDTH;
  const widths = computeWidths(terminalWidth);

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
        <Text bold color="cyan">
          {'DOI'.padEnd(widths.doi)}
        </Text>
        <Text bold color="cyan">
          {'Title'.padEnd(widths.title)}
        </Text>
        <Text bold color="cyan">
          {'Year'.padEnd(widths.year)}
        </Text>
        <Text bold color="cyan">
          {'Status'.padEnd(widths.status)}
        </Text>
      </Box>
      {rows.map((row) => (
        <Box key={row.doi}>
          <Text>{truncate(row.doi || '', widths.doi - 1).padEnd(widths.doi)}</Text>
          <Text>{truncate(row.title || '(no title)', widths.title - 1).padEnd(widths.title)}</Text>
          <Text>{String(row.year || '').padEnd(widths.year)}</Text>
          <Text color={statusColor(row.verificationStatus)}>
            {row.verificationStatus.padEnd(widths.status)}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function truncate(value: string, maxLen: number): string {
  return value.length > maxLen ? value.slice(0, maxLen) : value;
}
