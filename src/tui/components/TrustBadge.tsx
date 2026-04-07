import React from 'react';
import { Text } from 'ink';

export function TrustBadge({ score }: { score: number }): React.ReactElement {
  const color = score >= 0.7 ? 'green' : score >= 0.4 ? 'yellow' : 'red';
  return <Text color={color}>{score.toFixed(2)}</Text>;
}
