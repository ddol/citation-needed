import fs from 'fs';
import path from 'path';
import type { Citation } from '../models/citation';
import type { Database } from '../db/index';
import { getDatabase } from '../db/index';
import { getCitationFileStem } from '../utils/file';
import { sha256File, sha256String } from '../utils/hash';
import {
  extractPdfMarkdown,
  PDF_MARKDOWN_EXTRACTOR_NAME,
  PDF_MARKDOWN_EXTRACTOR_VERSION,
} from '../verification/markdown';

export interface MarkdownReextractOptions {
  db?: Database;
  doi?: string;
  limit?: number;
  markdownPath?: string;
  extractMarkdown?: (pdfPath: string) => Promise<string>;
  onProgress?: (progress: MarkdownReextractProgress) => void;
}

export interface MarkdownFolderReextractOptions {
  paperPath: string;
  markdownPath: string;
  limit?: number;
  recursive?: boolean;
  extractMarkdown?: (pdfPath: string) => Promise<string>;
  onProgress?: (progress: MarkdownReextractProgress) => void;
}

export interface MarkdownReextractError {
  doi: string;
  message: string;
}

export interface MarkdownReextractSummary {
  scanned: number;
  extracted: number;
  missingPdf: number;
  failed: number;
  errors: MarkdownReextractError[];
}

export interface MarkdownReextractProgress {
  current: number;
  total: number;
  doi?: string;
  status: 'starting' | 'extracted' | 'missing-pdf' | 'failed';
  markdownPath?: string;
}

function getCitations(db: Database, doi?: string): Citation[] {
  if (doi) {
    const citation = db.getCitation(doi);
    return citation ? [citation] : [];
  }
  return db.getAllCitations();
}

function markdownPathForCitation(
  citation: Citation,
  db: Database,
  markdownDir?: string
): string | undefined {
  if (citation.id != null) {
    const manifestation = db.getManifestation(citation.id, 'markdown-extracted');
    if (manifestation) return manifestation.path;
  }

  if (markdownDir) {
    return path.join(markdownDir, `${getCitationFileStem(citation)}.md`);
  }

  return undefined;
}

function listPdfFiles(root: string, recursive: boolean): string[] {
  if (!fs.existsSync(root)) return [];

  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory() && recursive) {
      files.push(...listPdfFiles(fullPath, true));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function markdownPathForPdf(pdfRoot: string, markdownRoot: string, pdfPath: string): string {
  const relative = path.relative(pdfRoot, pdfPath).replace(/\.pdf$/i, '.md');
  return path.join(markdownRoot, relative);
}

export async function reextractMarkdownFromLocalPdfs(
  options: MarkdownReextractOptions = {}
): Promise<MarkdownReextractSummary> {
  const db = options.db ?? getDatabase();
  const extractMarkdown = options.extractMarkdown ?? extractPdfMarkdown;
  const markdownDir = options.markdownPath ? path.resolve(options.markdownPath) : undefined;
  const citations = getCitations(db, options.doi).slice(0, options.limit);
  const emitProgress = options.onProgress ?? (() => undefined);
  const summary: MarkdownReextractSummary = {
    scanned: 0,
    extracted: 0,
    missingPdf: 0,
    failed: 0,
    errors: [],
  };

  emitProgress({ current: 0, total: citations.length, status: 'starting' });

  for (const citation of citations) {
    summary.scanned += 1;

    if (citation.id == null || !citation.pdfPath || !fs.existsSync(citation.pdfPath)) {
      summary.missingPdf += 1;
      emitProgress({
        current: summary.scanned,
        total: citations.length,
        doi: citation.doi,
        status: 'missing-pdf',
      });
      continue;
    }

    const markdownFile = markdownPathForCitation(citation, db, markdownDir);
    if (!markdownFile) {
      summary.failed += 1;
      summary.errors.push({
        doi: citation.doi,
        message: 'No Markdown path is known; pass --markdown-path to create one.',
      });
      emitProgress({
        current: summary.scanned,
        total: citations.length,
        doi: citation.doi,
        status: 'failed',
      });
      continue;
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      const markdown = await extractMarkdown(citation.pdfPath);
      fs.mkdirSync(path.dirname(markdownFile), { recursive: true });
      fs.writeFileSync(markdownFile, markdown, 'utf-8');
      const contentHash = sha256String(markdown);

      db.upsertManifestation({
        citationId: citation.id,
        kind: 'markdown-extracted',
        path: markdownFile,
        contentHash,
        extractorName: PDF_MARKDOWN_EXTRACTOR_NAME,
        extractorVersion: PDF_MARKDOWN_EXTRACTOR_VERSION,
      });
      db.upsertManifestation({
        citationId: citation.id,
        kind: 'pdf',
        path: citation.pdfPath,
        // eslint-disable-next-line no-await-in-loop
        contentHash: await sha256File(citation.pdfPath),
      });
      summary.extracted += 1;
      emitProgress({
        current: summary.scanned,
        total: citations.length,
        doi: citation.doi,
        status: 'extracted',
        markdownPath: markdownFile,
      });
    } catch (error) {
      summary.failed += 1;
      summary.errors.push({
        doi: citation.doi,
        message: error instanceof Error ? error.message : String(error),
      });
      emitProgress({
        current: summary.scanned,
        total: citations.length,
        doi: citation.doi,
        status: 'failed',
      });
    }
  }

  return summary;
}

export async function reextractMarkdownFromPdfFolder(
  options: MarkdownFolderReextractOptions
): Promise<MarkdownReextractSummary> {
  const extractMarkdown = options.extractMarkdown ?? extractPdfMarkdown;
  const pdfRoot = path.resolve(options.paperPath);
  const markdownRoot = path.resolve(options.markdownPath);
  const pdfs = listPdfFiles(pdfRoot, Boolean(options.recursive)).slice(0, options.limit);
  const emitProgress = options.onProgress ?? (() => undefined);
  const summary: MarkdownReextractSummary = {
    scanned: 0,
    extracted: 0,
    missingPdf: 0,
    failed: 0,
    errors: [],
  };

  emitProgress({ current: 0, total: pdfs.length, status: 'starting' });

  for (const pdfPath of pdfs) {
    summary.scanned += 1;
    const id = path.basename(pdfPath, path.extname(pdfPath));
    const markdownFile = markdownPathForPdf(pdfRoot, markdownRoot, pdfPath);

    try {
      // eslint-disable-next-line no-await-in-loop
      const markdown = await extractMarkdown(pdfPath);
      fs.mkdirSync(path.dirname(markdownFile), { recursive: true });
      fs.writeFileSync(markdownFile, markdown, 'utf-8');
      summary.extracted += 1;
      emitProgress({
        current: summary.scanned,
        total: pdfs.length,
        doi: id,
        status: 'extracted',
        markdownPath: markdownFile,
      });
    } catch (error) {
      summary.failed += 1;
      summary.errors.push({
        doi: id,
        message: error instanceof Error ? error.message : String(error),
      });
      emitProgress({
        current: summary.scanned,
        total: pdfs.length,
        doi: id,
        status: 'failed',
      });
    }
  }

  return summary;
}
