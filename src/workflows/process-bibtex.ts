import fs from 'fs';
import path from 'path';
import type { Database } from '../db/index';
import { getDatabase } from '../db/index';
import { loadAuthConfig } from '../auth/config';
import type { AuthConfig } from '../models/auth';
import type { RetrievalResult } from '../models/retrieval';
import { parseBibtex } from '../parsers/bibtex';
import type { ParsedEntry } from '../parsers/bibtex';
import { isValidDoi, normalizeDoi } from '../parsers/doi';
import { RetrievalOrchestrator } from '../retrieval/index';
import { ensureDir, getCitationDisplayName, getCitationFileStem } from '../utils/file';
import { extractPdfMarkdown } from '../verification/markdown';

export interface ProcessBibtexProgress {
  doi?: string;
  label: string;
  fileStem: string;
  stage: 'retrieving' | 'markdown' | 'completed' | 'failed' | 'skipped';
  message?: string;
}

export interface ProcessBibtexOptions {
  paperPath?: string;
  markdownPath?: string;
  email?: string;
  db?: Database;
  authConfig?: AuthConfig;
  retrievePdf?: (doi: string, entry: ParsedEntry) => Promise<RetrievalResult>;
  extractMarkdown?: (pdfPath: string) => Promise<string>;
  onProgress?: (progress: ProcessBibtexProgress) => void;
}

export interface ProcessBibtexFailure {
  doi: string;
  stage: 'download' | 'markdown';
  message: string;
}

export interface ProcessBibtexSkipped {
  bibtexKey?: string;
  label: string;
  reason: string;
}

export interface ProcessBibtexResult {
  bibtexPath: string;
  paperPath: string;
  markdownPath: string;
  importedCount: number;
  downloadedCount: number;
  markdownCount: number;
  skippedCount: number;
  failures: ProcessBibtexFailure[];
  skippedEntries: ProcessBibtexSkipped[];
}

export async function processBibtexFile(
  bibtexPath: string,
  options: ProcessBibtexOptions = {}
): Promise<ProcessBibtexResult> {
  const resolvedBibtexPath = path.resolve(bibtexPath);
  const bibtexDir = path.dirname(resolvedBibtexPath);
  const paperPath = path.resolve(options.paperPath || path.join(bibtexDir, 'papers', 'pdf'));
  const markdownPath = path.resolve(
    options.markdownPath || path.join(bibtexDir, 'papers', 'markdown')
  );

  ensureDir(paperPath);
  ensureDir(markdownPath);

  const db = options.db ?? getDatabase();
  const authConfig = {
    ...loadAuthConfig(),
    ...(options.authConfig || {}),
    ...(options.email ? { email: options.email } : {}),
  };
  const retriever = options.retrievePdf
    ? { retrievePdf: options.retrievePdf }
    : new RetrievalOrchestrator(db, authConfig, paperPath);
  const extractMarkdown = options.extractMarkdown ?? extractPdfMarkdown;
  const emitProgress = options.onProgress ?? (() => undefined);

  const content = fs.readFileSync(resolvedBibtexPath, 'utf-8');
  const parsed = parseBibtex(content);

  let importedCount = 0;
  let downloadedCount = 0;
  let markdownCount = 0;
  let skippedCount = 0;
  const failures: ProcessBibtexFailure[] = [];
  const skippedEntries: ProcessBibtexSkipped[] = [];

  for (const entry of parsed) {
    const label = getCitationDisplayName(entry);

    if (!entry.doi) {
      const fileStem = getCitationFileStem(entry);
      const reason = 'no DOI';
      skippedCount += 1;
      skippedEntries.push({ bibtexKey: entry.bibtexKey, label, reason });
      emitProgress({
        label,
        fileStem,
        stage: 'skipped',
        message: `Skipped: ${reason}`,
      });
      continue;
    }

    const normalizedDoi = normalizeDoi(entry.doi);
    const normalizedEntry = { ...entry, doi: normalizedDoi };
    const fileStem = getCitationFileStem(normalizedEntry);

    if (!isValidDoi(normalizedDoi)) {
      const reason = `invalid DOI format: ${entry.doi}`;
      skippedCount += 1;
      skippedEntries.push({ bibtexKey: entry.bibtexKey, label, reason });
      emitProgress({
        label,
        fileStem,
        stage: 'skipped',
        message: `Skipped: ${reason}`,
      });
      continue;
    }

    const stored = db.addCitation(normalizedEntry);
    importedCount += 1;
    emitProgress({
      doi: normalizedDoi,
      label,
      fileStem,
      stage: 'retrieving',
      message: 'Downloading PDF',
    });

    const startedAt = Date.now();
    const retrieval = await retriever.retrievePdf(normalizedDoi, entry);
    const durationMs = Date.now() - startedAt;

    // Audit log: one retrieval_log row per attempt (success or failure) so the
    // import history is queryable after the fact. Skip if we don't have a
    // citation_id (legacy mock DBs in tests may not implement logRetrieval).
    if (typeof db.logRetrieval === 'function' && stored?.id != null) {
      try {
        db.logRetrieval({
          citationId: stored.id,
          source: `bibtex-import:${retrieval.source}`,
          url: retrieval.pdfUrl,
          success: retrieval.success,
          errorMessage: retrieval.success ? undefined : retrieval.message,
          durationMs,
        });
      } catch {
        // Audit-log writes must never break the workflow; swallow silently.
      }
    }

    if (!retrieval.success || !retrieval.localPath) {
      failures.push({
        doi: normalizedDoi,
        stage: 'download',
        message: retrieval.message,
      });
      emitProgress({
        doi: normalizedDoi,
        label,
        fileStem,
        stage: 'failed',
        message: retrieval.message,
      });
      continue;
    }

    downloadedCount += 1;
    emitProgress({
      doi: normalizedDoi,
      label,
      fileStem,
      stage: 'markdown',
      message: 'Generating Markdown',
    });

    try {
      const markdown = await extractMarkdown(retrieval.localPath);
      const markdownFile = path.join(markdownPath, `${fileStem}.md`);
      fs.writeFileSync(markdownFile, markdown, 'utf-8');
      markdownCount += 1;
      emitProgress({
        doi: normalizedDoi,
        label,
        fileStem,
        stage: 'completed',
        message: 'PDF downloaded and Markdown created',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({
        doi: normalizedDoi,
        stage: 'markdown',
        message,
      });
      emitProgress({
        doi: normalizedDoi,
        label,
        fileStem,
        stage: 'failed',
        message,
      });
    }
  }

  return {
    bibtexPath: resolvedBibtexPath,
    paperPath,
    markdownPath,
    importedCount,
    downloadedCount,
    markdownCount,
    skippedCount,
    failures,
    skippedEntries,
  };
}
