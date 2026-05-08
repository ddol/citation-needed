import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp } from 'ink';
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

export function ImportProgress({
  bibtexPath,
  options,
}: {
  bibtexPath: string;
  options: Omit<ProcessBibtexOptions, 'onProgress'>;
}): React.ReactElement {
  const { exit } = useApp();
  const [frameIndex, setFrameIndex] = useState(0);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [result, setResult] = useState<ProcessBibtexResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeRowCount = useMemo(
    () => rows.filter((row) => row.stage === 'retrieving' || row.stage === 'markdown').length,
    [rows]
  );

  useEffect(() => {
    if (activeRowCount === 0) {
      return undefined;
    }

    const interval = setInterval(() => {
      setFrameIndex((currentFrame) => (currentFrame + 1) % SPINNER_FRAMES.length);
    }, 80);

    return () => clearInterval(interval);
  }, [activeRowCount]);

  useEffect(() => {
    let isMounted = true;
    const previousLogLevel = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'silent';

    const handleProgress = (progress: ProcessBibtexProgress): void => {
      if (!isMounted) {
        return;
      }

      setRows((currentRows) => {
        const rowKey = progress.doi || progress.fileStem || progress.label;
        const nextRow: ImportRow = { ...progress, key: rowKey };
        const existingIndex = currentRows.findIndex((row) => row.key === rowKey);

        if (existingIndex === -1) {
          return [...currentRows, nextRow];
        }

        const updatedRows = [...currentRows];
        updatedRows[existingIndex] = nextRow;
        return updatedRows;
      });
    };

    void processBibtexFile(bibtexPath, {
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

  return (
    <Box flexDirection="column">
      <Text bold>Importing {bibtexPath}</Text>
      <Box flexDirection="column" marginTop={1}>
        {rows.length === 0 ? <Text dimColor>Waiting for citations...</Text> : null}
        {rows.map((row) => (
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
          <Text>PDF output: {result.paperPath}</Text>
          <Text>Markdown output: {result.markdownPath}</Text>
          {result.failures.length > 0 ? (
            <Box flexDirection="column">
              <Text color="yellow">Failures:</Text>
              {result.failures.map((failure) => (
                <Text key={`${failure.doi}-${failure.stage}`} dimColor>
                  {failure.doi} [{failure.stage}] {failure.message}
                </Text>
              ))}
            </Box>
          ) : null}
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