import fs from 'fs';
import React from 'react';
import { render, Box, Text } from 'ink';
import { Command } from 'commander';
import type { Database } from '../../db/index';
import { getDatabase } from '../../db/index';
import { getDbPath } from '../../utils/file';

export interface ResetOptions {
  files?: boolean;
  yes?: boolean;
  db?: string;
}

export interface ResetSummary {
  dbPath: string;
  counts: { citations: number; retrievalLog: number; manifestations: number; chunks: number };
  /** Files recorded in the DB that currently exist on disk. */
  trackedFiles: string[];
  deletedFiles: string[];
  failedFiles: { path: string; message: string }[];
  applied: boolean;
}

/**
 * Wipe the local citation database, and optionally the PDF/Markdown files it
 * points at. Destructive and irreversible, so it reports and stops unless the
 * caller explicitly passes `yes` — a bare `reset` is always a dry run.
 */
export function resetDatabase(db: Database, options: ResetOptions = {}): ResetSummary {
  const counts = db.getRowCounts();
  const trackedFiles = db.getStoredFilePaths().filter((p) => fs.existsSync(p));
  const deletedFiles: string[] = [];
  const failedFiles: { path: string; message: string }[] = [];

  if (!options.yes) {
    return {
      dbPath: options.db ?? getDbPath(),
      counts,
      trackedFiles,
      deletedFiles,
      failedFiles,
      applied: false,
    };
  }

  // Files first: if this throws we still hold the DB rows that name them, so
  // the user can retry. Wiping the DB first would orphan the files silently.
  if (options.files) {
    for (const file of trackedFiles) {
      try {
        fs.rmSync(file);
        deletedFiles.push(file);
      } catch (err) {
        failedFiles.push({ path: file, message: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  db.deleteAllCitations();
  db.vacuum();

  return {
    dbPath: options.db ?? getDbPath(),
    counts,
    trackedFiles,
    deletedFiles,
    failedFiles,
    applied: true,
  };
}

function ResetReport({ summary, files }: { summary: ResetSummary; files: boolean }): JSX.Element {
  const { counts, applied } = summary;
  const empty = counts.citations === 0 && counts.retrievalLog === 0;

  if (!applied) {
    return (
      <Box flexDirection="column">
        <Text bold>Dry run — nothing has been deleted.</Text>
        <Text />
        <Text>
          Database: <Text color="cyan">{summary.dbPath}</Text>
        </Text>
        <Text>
          {'  '}citations: {counts.citations}, retrieval_log: {counts.retrievalLog}, manifestations:{' '}
          {counts.manifestations}, chunks: {counts.chunks}
        </Text>
        <Text />
        {files ? (
          <Text>
            Would also delete <Text color="yellow">{summary.trackedFiles.length}</Text> tracked
            file(s) from disk.
          </Text>
        ) : (
          <Text dimColor>
            Tracked files on disk ({summary.trackedFiles.length}) will be kept. Pass --files to
            delete them too.
          </Text>
        )}
        <Text />
        {empty && !summary.trackedFiles.length ? (
          <Text dimColor>Nothing to reset.</Text>
        ) : (
          <Text color="yellow">Re-run with --yes to apply. This cannot be undone.</Text>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="green" bold>
        Reset complete.
      </Text>
      <Text />
      <Text>
        Removed {counts.citations} citation(s), {counts.retrievalLog} retrieval-log row(s),{' '}
        {counts.manifestations} manifestation(s), {counts.chunks} chunk(s).
      </Text>
      {files && <Text>Deleted {summary.deletedFiles.length} file(s) from disk.</Text>}
      {summary.failedFiles.map((f) => (
        <Text key={f.path} color="red">
          Could not delete {f.path}: {f.message}
        </Text>
      ))}
    </Box>
  );
}

export function registerResetCommand(program: Command): void {
  program
    .command('reset')
    .description('Maintenance: wipe the local citation database (dry run unless --yes)')
    .option('--files', 'Also delete the PDF and Markdown files recorded in the database')
    .option('-y, --yes', 'Actually perform the reset')
    .option('--db <path>', 'Path to the database file (defaults to the configured location)')
    .action((options: ResetOptions) => {
      const db = options.db ? getDatabase(options.db) : getDatabase();
      try {
        const summary = resetDatabase(db, options);
        render(<ResetReport summary={summary} files={Boolean(options.files)} />);
        if (summary.failedFiles.length) process.exitCode = 1;
      } catch (err) {
        render(<Text color="red">{err instanceof Error ? err.message : String(err)}</Text>);
        process.exitCode = 1;
      }
    });
}
