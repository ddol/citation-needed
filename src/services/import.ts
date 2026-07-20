import path from 'path';
import fs from 'fs';
import type { Database } from '../db/index';
import {
  processBibtex,
  type ProcessBibtexOptions,
  type ProcessBibtexProgress,
  type ProcessBibtexResult,
} from '../workflows/process-bibtex';

/**
 * A BibTeX import, named either as a file on disk or as content already in
 * memory. The CLI has a path; the MCP tool is handed a string over the wire.
 */
export type ImportSource = { bibtexPath: string } | { bibtex: string };

export interface ImportRequest {
  source: ImportSource;
  paperPath?: string;
  markdownPath?: string;
  email?: string;
  /** Store citations without downloading PDFs or extracting Markdown. */
  metadataOnly?: boolean;
  onProgress?: (progress: ProcessBibtexProgress) => void;
}

/** Everything a caller may override for testing, kept off the public request. */
export type ImportOverrides = Pick<
  ProcessBibtexOptions,
  'authConfig' | 'retrievePdf' | 'extractMarkdown' | 'retryCooldownMs' | 'retryThrottled'
>;

/** Shown in place of a path when the BibTeX arrived as a string. */
export const INLINE_BIBTEX_LABEL = '(inline BibTeX)';

/**
 * The one import path. Both surfaces run the same pipeline over the same
 * database, so a .bib imported through the CLI and the same .bib imported
 * through MCP leave the store in the same state. Anything that differs between
 * them is a request field, not a second implementation.
 */
export class ImportService {
  constructor(private readonly db: Database) {}

  async import(request: ImportRequest, overrides: ImportOverrides = {}): Promise<ImportSummary> {
    const result = await processBibtex(toBibtexSource(request.source), {
      ...overrides,
      db: this.db,
      paperPath: request.paperPath,
      markdownPath: request.markdownPath,
      email: request.email,
      metadataOnly: request.metadataOnly,
      onProgress: request.onProgress,
    });
    return toSummary(result, request.metadataOnly ?? false);
  }
}

function toBibtexSource(source: ImportSource): {
  content: string;
  label: string;
  baseDir: string;
} {
  if ('bibtexPath' in source) {
    const resolved = path.resolve(source.bibtexPath);
    return {
      content: fs.readFileSync(resolved, 'utf-8'),
      label: resolved,
      baseDir: path.dirname(resolved),
    };
  }
  // In-memory BibTeX has no anchor directory, so output lands under the working
  // directory unless the caller names a path.
  return { content: source.bibtex, label: INLINE_BIBTEX_LABEL, baseDir: process.cwd() };
}

export interface ImportSummary extends ProcessBibtexResult {
  /** Where the BibTeX came from: a path, or INLINE_BIBTEX_LABEL. */
  source: string;
  metadataOnly: boolean;
}

function toSummary(result: ProcessBibtexResult, metadataOnly: boolean): ImportSummary {
  return { ...result, source: result.bibtexPath, metadataOnly };
}

/**
 * One-line summary for text surfaces (the MCP tool result, and any future
 * non-TUI caller). Counts a metadata-only run reports would be zeroes, so it
 * says nothing about downloads it never attempted.
 */
export function formatImportSummary(summary: ImportSummary): string {
  const parts = [`Imported ${summary.importedCount} citations from ${summary.source}`];
  if (!summary.metadataOnly) {
    parts.push(`downloaded ${summary.downloadedCount} PDFs`);
    parts.push(`wrote ${summary.markdownCount} Markdown files`);
  }
  if (summary.skippedCount > 0) {
    const reasons = summary.skippedEntries.map((entry) => `${entry.label} (${entry.reason})`);
    parts.push(`skipped ${summary.skippedCount}: ${reasons.join(', ')}`);
  }
  if (summary.failures.length > 0) {
    const failures = summary.failures.map((failure) => `${failure.doi} (${failure.message})`);
    parts.push(`failed ${summary.failures.length}: ${failures.join(', ')}`);
  }
  return `${parts.join('. ')}.`;
}
