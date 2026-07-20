import fs from 'fs';
import { Command } from 'commander';
import type { Database } from '../../db/index';
import { getDatabase } from '../../db/index';
import { getDbPath } from '../../utils/file';
import { bold, cyan, dim, green, print, printError, red, yellow } from '../output';

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

    if (failedFiles.length > 0) {
      return {
        dbPath: options.db ?? getDbPath(),
        counts,
        trackedFiles,
        deletedFiles,
        failedFiles,
        applied: false,
      };
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

export function formatResetSummary(summary: ResetSummary, files: boolean): string[] {
  const { counts } = summary;

  if (summary.applied) {
    return [
      green(bold('Reset complete.')),
      '',
      `Removed ${counts.citations} citation(s), ${counts.retrievalLog} retrieval-log row(s), ` +
        `${counts.manifestations} manifestation(s), ${counts.chunks} chunk(s).`,
      ...(files ? [`Deleted ${summary.deletedFiles.length} file(s) from disk.`] : []),
    ];
  }

  if (summary.failedFiles.length > 0) {
    return [
      red(bold('Reset stopped.')),
      '',
      `Deleted ${summary.deletedFiles.length} file(s), but ${summary.failedFiles.length} file(s) could not be deleted.`,
      'The database was left intact so you can fix file permissions and retry.',
    ];
  }

  const nothingToDo = counts.citations === 0 && !summary.trackedFiles.length;

  return [
    bold('Dry run — nothing has been deleted.'),
    '',
    `Database: ${cyan(summary.dbPath)}`,
    `  citations: ${counts.citations}, retrieval_log: ${counts.retrievalLog}, ` +
      `manifestations: ${counts.manifestations}, chunks: ${counts.chunks}`,
    '',
    files
      ? `Would also delete ${yellow(String(summary.trackedFiles.length))} tracked file(s) from disk.`
      : dim(
          `Tracked files on disk (${summary.trackedFiles.length}) will be kept. ` +
            `Pass --files to delete them too.`
        ),
    '',
    nothingToDo
      ? dim('Nothing to reset.')
      : yellow('Re-run with --yes to apply. This cannot be undone.'),
  ];
}

export function registerResetCommand(program: Command): void {
  program
    .command('reset')
    .description('Maintenance: wipe the local citation database (dry run unless --yes)')
    .option('--files', 'Also delete the PDF and Markdown files recorded in the database')
    .option('-y, --yes', 'Actually perform the reset')
    .option('--db <path>', 'Path to the database file (defaults to the configured location)')
    .action((options: ResetOptions) => {
      // An explicit --db path gets its own Database instance rather than the
      // shared singleton, so this command is the only thing that can close it.
      const ownsDb = Boolean(options.db);
      const db = options.db ? getDatabase(options.db) : getDatabase();
      try {
        const summary = resetDatabase(db, options);
        print(...formatResetSummary(summary, Boolean(options.files)));
        for (const failure of summary.failedFiles) {
          printError(red(`Could not delete ${failure.path}: ${failure.message}`));
        }
        if (summary.failedFiles.length) process.exitCode = 1;
      } catch (err) {
        printError(red(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      } finally {
        if (ownsDb) db.close();
      }
    });
}
