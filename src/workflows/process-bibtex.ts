import fs from 'fs';
import path from 'path';
import type { Database } from '../db/index';
import { getDatabase } from '../db/index';
import { loadAuthConfig } from '../auth/config';
import type { AuthConfig } from '../models/auth';
import type { RetrievalResult } from '../models/retrieval';
import { parseBibtex } from '../parsers/bibtex';
import { RetrievalOrchestrator } from '../retrieval/index';
import { ensureDir, sanitizeFilename } from '../utils/file';
import { extractPdfMarkdown } from '../verification/markdown';

export interface ProcessBibtexOptions {
  paperPath?: string;
  markdownPath?: string;
  email?: string;
  db?: Database;
  authConfig?: AuthConfig;
  retrievePdf?: (doi: string) => Promise<RetrievalResult>;
  extractMarkdown?: (pdfPath: string) => Promise<string>;
}

export interface ProcessBibtexFailure {
  doi: string;
  stage: 'download' | 'markdown';
  message: string;
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
}

export async function processBibtexFile(
  bibtexPath: string,
  options: ProcessBibtexOptions = {}
): Promise<ProcessBibtexResult> {
  const resolvedBibtexPath = path.resolve(bibtexPath);
  const bibtexDir = path.dirname(resolvedBibtexPath);
  const paperPath = path.resolve(options.paperPath || path.join(bibtexDir, 'papers'));
  const markdownPath = path.resolve(
    options.markdownPath || path.join(bibtexDir, 'markdown')
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

  const content = fs.readFileSync(resolvedBibtexPath, 'utf-8');
  const parsed = parseBibtex(content);

  let importedCount = 0;
  let downloadedCount = 0;
  let markdownCount = 0;
  let skippedCount = 0;
  const failures: ProcessBibtexFailure[] = [];

  for (const entry of parsed) {
    if (!entry.doi) {
      skippedCount += 1;
      continue;
    }

    db.addCitation({ ...entry, doi: entry.doi });
    importedCount += 1;

    const retrieval = await retriever.retrievePdf(entry.doi);
    if (!retrieval.success || !retrieval.localPath) {
      failures.push({
        doi: entry.doi,
        stage: 'download',
        message: retrieval.message,
      });
      continue;
    }

    downloadedCount += 1;

    try {
      const markdown = await extractMarkdown(retrieval.localPath);
      const markdownFile = path.join(markdownPath, `${sanitizeFilename(entry.doi)}.md`);
      fs.writeFileSync(markdownFile, markdown, 'utf-8');
      markdownCount += 1;
    } catch (error) {
      failures.push({
        doi: entry.doi,
        stage: 'markdown',
        message: error instanceof Error ? error.message : String(error),
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
  };
}
