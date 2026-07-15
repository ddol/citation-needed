import React, { useEffect, useMemo, useState } from 'react';
import { Box, Static, Text, useApp } from 'ink';
import {
  processBibtexFile,
  type ProcessBibtexOptions,
  type ProcessBibtexProgress,
  type ProcessBibtexResult,
} from '../../workflows/process-bibtex';

const SPINNER_FRAMES = ['⡿', '⣟', '⣯', '⣷', '⣾', '⣽', '⣻', '⢿'];

interface ImportRow extends ProcessBibtexProgress {
  key: string;
}

type FinishedStage = 'completed' | 'failed' | 'skipped';

function isFinished(stage: ProcessBibtexProgress['stage']): stage is FinishedStage {
  return stage === 'completed' || stage === 'failed' || stage === 'skipped';
}

/** A header line plus one line per finished row — everything printed exactly once. */
type StaticLine = { key: string; kind: 'header'; text: string } | (ImportRow & { kind: 'row' });

export function ImportProgress({
  bibtexPath,
  options,
}: {
  bibtexPath: string;
  options: Omit<ProcessBibtexOptions, 'onProgress'>;
}): React.ReactElement {
  const { exit } = useApp();
  const [frameIndex, setFrameIndex] = useState(0);
  // Split by lifecycle, not one list: Ink redraws its live tree every frame by
  // clearing and rewriting those lines. Once the tree is taller than the
  // terminal it cannot clear what has scrolled off, and the output tears. Only
  // in-flight rows stay live; finished rows are handed to <Static>, which
  // prints each one once and never touches it again.
  const [finished, setFinished] = useState<ImportRow[]>([]);
  const [active, setActive] = useState<ImportRow[]>([]);
  const [result, setResult] = useState<ProcessBibtexResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (active.length === 0) {
      return undefined;
    }

    const interval = setInterval(() => {
      setFrameIndex((currentFrame) => (currentFrame + 1) % SPINNER_FRAMES.length);
    }, 80);

    return () => clearInterval(interval);
  }, [active.length]);

  useEffect(() => {
    let isMounted = true;
    const previousLogLevel = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'silent';

    const handleProgress = (progress: ProcessBibtexProgress): void => {
      if (!isMounted) {
        return;
      }

      const rowKey = progress.doi || progress.fileStem || progress.label;
      const row: ImportRow = { ...progress, key: rowKey };

      if (isFinished(progress.stage)) {
        // Append-only: <Static> replays by index, so a finished row must never
        // move or change once emitted.
        setActive((current) => current.filter((r) => r.key !== rowKey));
        setFinished((current) =>
          current.some((r) => r.key === rowKey) ? current : [...current, row]
        );
        return;
      }

      setActive((current) => {
        const index = current.findIndex((r) => r.key === rowKey);
        if (index === -1) return [...current, row];
        const next = [...current];
        next[index] = row;
        return next;
      });
    };

    processBibtexFile(bibtexPath, {
      ...options,
      onProgress: handleProgress,
    })
      .then((nextResult) => {
        if (isMounted) {
          setResult(nextResult);
        }
      })
      .catch((error) => {
        if (isMounted) {
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (previousLogLevel === undefined) {
          delete process.env.LOG_LEVEL;
        } else {
          process.env.LOG_LEVEL = previousLogLevel;
        }
      });

    return () => {
      isMounted = false;
      if (previousLogLevel === undefined) {
        delete process.env.LOG_LEVEL;
      } else {
        process.env.LOG_LEVEL = previousLogLevel;
      }
    };
  }, [bibtexPath, options]);

  useEffect(() => {
    if (result || errorMessage) {
      exit();
    }
  }, [errorMessage, exit, result]);

  // <Static> always prints above the live frame, so the header has to be a
  // static item too — in the live tree it would sink below every row.
  const staticLines = useMemo<StaticLine[]>(
    () => [
      { key: '__header', kind: 'header', text: bibtexPath },
      ...finished.map((row) => ({ ...row, kind: 'row' as const })),
    ],
    [bibtexPath, finished]
  );

  return (
    <Box flexDirection="column">
      <Static items={staticLines}>
        {(line) =>
          line.kind === 'header' ? (
            <Text key={line.key} bold>
              Importing {line.text}
            </Text>
          ) : (
            <Text key={line.key}>
              <Text color={getMarkerColor(line.stage)}>{getMarker(line.stage, frameIndex)}</Text>
              <Text> {line.label}</Text>
              <Text dimColor> {line.message || defaultStageMessage(line.stage)}</Text>
            </Text>
          )
        }
      </Static>

      <Box flexDirection="column">
        {finished.length === 0 && active.length === 0 ? (
          <Text dimColor>Waiting for citations...</Text>
        ) : null}
        {active.map((row) => (
          <Text key={row.key}>
            <Text color={getMarkerColor(row.stage)}>{getMarker(row.stage, frameIndex)}</Text>
            <Text> {row.label}</Text>
            <Text dimColor> {row.message || defaultStageMessage(row.stage)}</Text>
          </Text>
        ))}
      </Box>

      {result ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="green">Processed BibTeX file: {result.bibtexPath}</Text>
          <Text>Imported citations: {result.importedCount}</Text>
          <Text>Downloaded PDFs: {result.downloadedCount}</Text>
          <Text>Generated Markdown files: {result.markdownCount}</Text>
          <Text>Skipped entries without DOI: {result.skippedCount}</Text>
          {result.failures.length > 0 ? (
            <Text color="yellow">Failed to retrieve: {result.failures.length} (listed above)</Text>
          ) : null}
          <Text>PDF output: {result.paperPath}</Text>
          <Text>Markdown output: {result.markdownPath}</Text>
        </Box>
      ) : null}

      {errorMessage ? (
        <Box marginTop={1}>
          <Text color="red">Import failed: {errorMessage}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function getMarker(stage: ImportRow['stage'], frameIndex: number): string {
  if (stage === 'retrieving' || stage === 'markdown') {
    return SPINNER_FRAMES[frameIndex];
  }

  if (stage === 'completed') {
    return '✓';
  }

  if (stage === 'skipped') {
    return '•';
  }

  return '✗';
}

function getMarkerColor(stage: ImportRow['stage']): 'cyan' | 'green' | 'yellow' | 'red' {
  if (stage === 'retrieving' || stage === 'markdown') {
    return 'cyan';
  }

  if (stage === 'completed') {
    return 'green';
  }

  if (stage === 'skipped') {
    return 'yellow';
  }

  return 'red';
}

function defaultStageMessage(stage: ImportRow['stage']): string {
  if (stage === 'retrieving') {
    return 'Downloading PDF';
  }

  if (stage === 'markdown') {
    return 'Generating Markdown';
  }

  if (stage === 'completed') {
    return 'Done';
  }

  if (stage === 'skipped') {
    return 'Skipped';
  }

  return 'Failed';
}
