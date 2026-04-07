import React from 'react';
import { Box, Text } from 'ink';
import { TrustBadge } from './TrustBadge';

export interface ScoreEvent {
  eventType: string;
  scoreDelta: number;
  notes?: string;
  createdAt?: string;
}

export function ScoreHistory({
  doi,
  score,
  trustLevel,
  history,
}: {
  doi: string;
  score: number;
  trustLevel: string;
  history: ScoreEvent[];
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>
        Trust Score for: <Text color="cyan">{doi}</Text>
      </Text>
      <Text>
        Score: <TrustBadge score={score} /> — Level: <Text bold>{trustLevel}</Text>
      </Text>
      {history.length > 0 && (
        <Box flexDirection="column">
          <Text bold>History:</Text>
          {history.map((e, i) => (
            <Text key={i} dimColor>
              [{e.createdAt?.slice(0, 10) ?? 'unknown'}] {e.eventType} Δ
              {e.scoreDelta >= 0 ? '+' : ''}
              {e.scoreDelta.toFixed(3)} — {e.notes || ''}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
