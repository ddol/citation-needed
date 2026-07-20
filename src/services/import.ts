import path from 'path';
import fs from 'fs';
import type { Database } from '../db/index';
import {
  processBibtex,
  type ProcessBibtexFailure,
  type ProcessBibtexOptions,
  type ProcessBibtexProgress,
  type ProcessBibtexResult,
  type ProcessBibtexSkipped,
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
 * The machine-readable shape of an import outcome, for programs rather than
 * people. Failures and skips carry their reasons as data so a caller can retry
 * the DOIs that failed without parsing prose, and the download fields are
 * omitted on a metadata-only run rather than reported as zeroes it never
 * attempted.
 */
export interface ImportReport {
  source: string;
  metadataOnly: boolean;
  imported: number;
  downloaded?: number;
  extracted?: number;
  paperPath?: string;
  markdownPath?: string;
  skipped: ProcessBibtexSkipped[];
  failures: ProcessBibtexFailure[];
}

export function toImportReport(summary: ImportSummary): ImportReport {
  return {
    source: summary.source,
    metadataOnly: summary.metadataOnly,
    imported: summary.importedCount,
    ...(summary.metadataOnly
      ? {}
      : {
          downloaded: summary.downloadedCount,
          extracted: summary.markdownCount,
          paperPath: summary.paperPath,
          markdownPath: summary.markdownPath,
        }),
    skipped: summary.skippedEntries,
    failures: summary.failures,
  };
}
