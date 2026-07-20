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
import { THROTTLE_COOLDOWN_MS } from '../retrieval/config';
import { ensureDir, getCitationDisplayName, getCitationFileStem } from '../utils/file';
import { sha256File, sha256String } from '../utils/hash';
import {
  extractPdfMarkdown,
  PDF_MARKDOWN_EXTRACTOR_NAME,
  PDF_MARKDOWN_EXTRACTOR_VERSION,
} from '../verification/markdown';

/**
 * Record file manifestations with content hashes at write time (the source
 * of truth for file locations and incremental re-indexing). Provenance must
 * never break an import, and legacy mock DBs in tests may not implement
 * upsertManifestation.
 */
async function recordManifestations(
  db: Database,
  citationId: number,
  pdfPath: string,
  markdownPath: string,
  markdown: string
): Promise<void> {
  if (typeof db.upsertManifestation !== 'function') return;
  try {
    db.upsertManifestation({
      citationId,
      kind: 'markdown-extracted',
      path: markdownPath,
      contentHash: sha256String(markdown),
      extractorName: PDF_MARKDOWN_EXTRACTOR_NAME,
      extractorVersion: PDF_MARKDOWN_EXTRACTOR_VERSION,
    });
    db.upsertManifestation({
      citationId,
      kind: 'pdf',
      path: pdfPath,
      contentHash: await sha256File(pdfPath),
    });
  } catch {
    // Never let provenance recording fail the import loop.
  }
}

export interface ProcessBibtexProgress {
  doi?: string;
  label: string;
  fileStem: string;
  stage: 'retrieving' | 'markdown' | 'completed' | 'failed' | 'skipped';
  message?: string;
  /** Set on the retry pass, so a listener can tell the two attempts apart. */
  pass?: 'retry';
  /**
   * True on exactly one event per BibTeX entry: the one carrying that entry's
   * final outcome. A throttled entry that is about to be retried is not settled
   * yet, and the synthetic retry banner is never settled because it is a notice
   * rather than an entry.
   *
   * Counting terminal-looking stages instead of this is wrong twice over: the
   * banner uses stage 'skipped', and the retry pass emits a second terminal
   * stage for an entry already counted. Only the workflow knows which event is
   * final, so it says so rather than leaving each consumer to infer it.
   *
   * This is not the same question as "should this row stop animating?", which
   * is what the terminal stages answer for the TUI. Both are now answerable.
   */
  settled: boolean;
}

export interface ProcessBibtexOptions {
  paperPath?: string;
  markdownPath?: string;
  email?: string;
  db?: Database;
  /**
   * Store metadata and stop: no retrieval, no extraction, no PDF or Markdown written.
   * A caller that only wants citations in the database should not have to pay
   * for downloads, and should not create output directories or leave half-finished rows behind.
   */
  metadataOnly?: boolean;
  authConfig?: AuthConfig;
  retrievePdf?: (doi: string, entry: ParsedEntry) => Promise<RetrievalResult>;
  extractMarkdown?: (pdfPath: string) => Promise<string>;
  onProgress?: (progress: ProcessBibtexProgress) => void;
  /**
   * Pause before retrying DOIs a rate limit refused. Defaults to
   * THROTTLE_COOLDOWN_MS; pass 0 in tests. A cooldown of 0 still retries — set
   * `retryThrottled: false` to skip the second pass entirely.
   */
  retryCooldownMs?: number;
  retryThrottled?: boolean;
}

/**
 * What the workflow needs from a retriever. `resetTransientState` is optional so
 * an injected `retrievePdf` function stays a valid retriever.
 */
interface Retriever {
  retrievePdf: (doi: string, entry: ParsedEntry) => Promise<RetrievalResult>;
  resetTransientState?: () => void;
}

/** Everything needed to attempt one entry, resolved once and reused per pass. */
interface PreparedEntry {
  entry: ParsedEntry;
  doi: string;
  fileStem: string;
  label: string;
  storedId?: number;
}

type AttemptOutcome = 'ok' | 'throttled' | 'failed';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

function addCitationForImport(
  db: Database,
  citation: ParsedEntry
): { stored?: ParsedEntry & { id?: number }; inserted: boolean } {
  if (typeof db.addCitationWithResult === 'function') {
    const result = db.addCitationWithResult(citation);
    return { stored: result.citation, inserted: result.inserted };
  }

  return { stored: db.addCitation(citation), inserted: true };
}

/**
 * Where the BibTeX came from. A file import defaults its output directories
 * beside the .bib; content handed over in memory (the MCP tool) has no such
 * anchor and falls back to the working directory.
 */
export interface BibtexSource {
  content: string;
  /** Absolute path when the source was a file, a display label otherwise. */
  label: string;
  baseDir: string;
}

export async function processBibtexFile(
  bibtexPath: string,
  options: ProcessBibtexOptions = {}
): Promise<ProcessBibtexResult> {
  const resolvedBibtexPath = path.resolve(bibtexPath);
  return processBibtex(
    {
      content: fs.readFileSync(resolvedBibtexPath, 'utf-8'),
      label: resolvedBibtexPath,
      baseDir: path.dirname(resolvedBibtexPath),
    },
    options
  );
}

export async function processBibtex(
  source: BibtexSource,
  options: ProcessBibtexOptions = {}
): Promise<ProcessBibtexResult> {
  const resolvedBibtexPath = source.label;
  const paperPath = path.resolve(options.paperPath || path.join(source.baseDir, 'papers', 'pdf'));
  const markdownPath = path.resolve(
    options.markdownPath || path.join(source.baseDir, 'papers', 'markdown')
  );
  const metadataOnly = options.metadataOnly ?? false;

  // Metadata-only writes nothing, so it must not create directories either.
  if (!metadataOnly) {
    ensureDir(paperPath);
    ensureDir(markdownPath);
  }

  const db = options.db ?? getDatabase();
  const authConfig = {
    ...loadAuthConfig(),
    ...(options.authConfig || {}),
    ...(options.email ? { email: options.email } : {}),
  };
  // Built on demand: constructing the orchestrator creates the PDF directory,
  // and a metadata-only run has no business leaving directories behind.
  let retrieverInstance: Retriever | undefined;
  const getRetriever = (): Retriever => {
    retrieverInstance ??= options.retrievePdf
      ? { retrievePdf: options.retrievePdf }
      : new RetrievalOrchestrator(db, authConfig, paperPath);
    return retrieverInstance;
  };
  const extractMarkdown = options.extractMarkdown ?? extractPdfMarkdown;
  const emitProgress = options.onProgress ?? (() => undefined);

  const parsed = parseBibtex(source.content);

  const retryCooldownMs = options.retryCooldownMs ?? THROTTLE_COOLDOWN_MS;
  const retryThrottled = options.retryThrottled ?? true;
  if (!metadataOnly) getRetriever().resetTransientState?.();

  let importedCount = 0;
  let downloadedCount = 0;
  let markdownCount = 0;
  let skippedCount = 0;
  const failures: ProcessBibtexFailure[] = [];
  const skippedEntries: ProcessBibtexSkipped[] = [];
  const throttledQueue: PreparedEntry[] = [];

  /**
   * Retrieve one entry and extract its Markdown. Shared by both passes so a
   * retry is the same operation, not a second implementation of it.
   *
   * Returns `throttled` only on the first pass: the caller queues those instead
   * of recording a failure, because they have not really been tried yet.
   */
  async function attemptEntry(prepared: PreparedEntry, pass?: 'retry'): Promise<AttemptOutcome> {
    const { doi, fileStem, label, storedId } = prepared;

    emitProgress({
      doi,
      label,
      fileStem,
      pass,
      stage: 'retrieving',
      message: 'Downloading PDF',
      settled: false,
    });

    const startedAt = Date.now();
    const retrieval = await getRetriever().retrievePdf(doi, prepared.entry);
    const durationMs = Date.now() - startedAt;

    // Audit log: one retrieval_log row per attempt (success or failure) so the
    // import history is queryable after the fact. Skip if we don't have a
    // citation_id (legacy mock DBs in tests may not implement logRetrieval).
    if (typeof db.logRetrieval === 'function' && storedId != null) {
      try {
        db.logRetrieval({
          citationId: storedId,
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
      // Queued entries are recorded by the retry pass, not here, so a DOI that
      // recovers never leaves a failure behind.
      const queueable = retrieval.throttled && pass !== 'retry';
      if (!queueable) {
        failures.push({
          doi,
          stage: 'download',
          message:
            pass === 'retry' && retrieval.throttled
              ? `Still rate limited after cooldown. ${retrieval.message}`
              : retrieval.message,
        });
      }
      emitProgress({
        doi,
        label,
        fileStem,
        pass,
        stage: 'failed',
        message: queueable ? 'Rate limited — queued for retry' : retrieval.message,
        // A queued entry has not finished: the retry pass will emit its real
        // outcome, and counting both would report more work than there is.
        settled: !queueable,
      });
      return retrieval.throttled ? 'throttled' : 'failed';
    }

    downloadedCount += 1;
    emitProgress({
      doi,
      label,
      fileStem,
      pass,
      stage: 'markdown',
      message: 'Generating Markdown',
      settled: false,
    });

    try {
      const markdown = await extractMarkdown(retrieval.localPath);
      const markdownFile = path.join(markdownPath, `${fileStem}.md`);
      fs.writeFileSync(markdownFile, markdown, 'utf-8');
      if (storedId != null) {
        await recordManifestations(db, storedId, retrieval.localPath, markdownFile, markdown);
      }
      markdownCount += 1;
      emitProgress({
        doi,
        label,
        fileStem,
        pass,
        stage: 'completed',
        message: 'PDF downloaded and Markdown created',
        settled: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ doi, stage: 'markdown', message });
      emitProgress({ doi, label, fileStem, pass, stage: 'failed', message, settled: true });
    }

    return 'ok';
  }

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
        settled: true,
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
        settled: true,
      });
      continue;
    }

    const { stored, inserted } = addCitationForImport(db, normalizedEntry);
    if (inserted) importedCount += 1;

    if (metadataOnly) {
      // 'completed' is honest here: storing the metadata was the whole job.
      emitProgress({
        doi: normalizedDoi,
        label,
        fileStem,
        stage: 'completed',
        message: inserted ? 'Imported metadata' : 'Metadata already stored',
        settled: true,
      });
      continue;
    }

    const prepared: PreparedEntry = {
      entry: normalizedEntry,
      doi: normalizedDoi,
      fileStem,
      label,
      storedId: stored?.id,
    };

    const outcome = await attemptEntry(prepared);
    if (outcome === 'throttled') throttledQueue.push(prepared);
  }

  // Second pass. A throttled DOI was never actually looked up — the source
  // refused before answering — so unlike "no source has this paper", waiting
  // changes the outcome. Reset the breaker first, or the retry is skipped by
  // the very state that queued it.
  if (throttledQueue.length > 0 && retryThrottled) {
    emitProgress({
      label: `${throttledQueue.length} rate-limited citation(s)`,
      fileStem: '__retry',
      stage: 'retrieving',
      message:
        retryCooldownMs >= 1000
          ? `Waiting ${Math.round(retryCooldownMs / 1000)}s for the rate limit to clear`
          : 'Waiting for the rate limit to clear',
      // Notices describe the run, not an entry, so they never settle.
      settled: false,
    });
    await sleep(retryCooldownMs);
    getRetriever().resetTransientState?.();
    emitProgress({
      label: `${throttledQueue.length} rate-limited citation(s)`,
      fileStem: '__retry',
      stage: 'skipped',
      message: 'Retrying now',
      settled: false,
    });

    for (const prepared of throttledQueue) {
      // One extra pass, not a retry loop: attemptEntry records the outcome,
      // including "still rate limited", and we do not queue it again.
      await attemptEntry(prepared, 'retry');
    }
  } else if (throttledQueue.length > 0) {
    for (const prepared of throttledQueue) {
      failures.push({ doi: prepared.doi, stage: 'download', message: 'Rate limited' });
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
