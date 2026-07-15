import fs from 'fs';
import path from 'path';
import { parseBibtex, type ParsedEntry } from '../parsers/bibtex';
import { isValidDoi, normalizeDoi } from '../parsers/doi';
import { getCitationDisplayName, getCitationFileStem, sanitizeFilename } from '../utils/file';
import { extractPdfMarkdown } from '../verification/markdown';

export type LocalPaperCheckStatus = 'matched' | 'missing' | 'mismatch' | 'ambiguous' | 'skipped';

export interface LocalPaperEvidence {
  doi: boolean;
  title: boolean;
  year: boolean;
  authors: string[];
  reasons: string[];
  extractionError?: string;
}

export interface LocalPaperCandidate {
  path: string;
  expectedName: boolean;
  evidence: LocalPaperEvidence;
}

export interface LocalPaperCheckEntry {
  bibtexKey?: string;
  label: string;
  doi?: string;
  title?: string;
  status: LocalPaperCheckStatus;
  expectedFilenames: string[];
  pdfPath?: string;
  candidates: LocalPaperCandidate[];
  message: string;
}

export interface LocalPaperCheckSummary {
  total: number;
  matched: number;
  missing: number;
  mismatch: number;
  ambiguous: number;
  skipped: number;
}

export interface LocalPaperCheckResult {
  bibtexPath: string;
  paperPath: string;
  summary: LocalPaperCheckSummary;
  entries: LocalPaperCheckEntry[];
}

export interface CheckLocalPapersOptions {
  paperPath?: string;
  recursive?: boolean;
  extractText?: (pdfPath: string) => Promise<string>;
}

interface ExtractedPdf {
  path: string;
  text: string;
  error?: string;
}

interface ScoredCandidate extends LocalPaperCandidate {
  strong: boolean;
}

function listPdfFiles(root: string, recursive: boolean): string[] {
  if (!fs.existsSync(root)) {
    throw new Error(`Paper directory not found: ${root}`);
  }

  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory() && recursive) {
      files.push(...listPdfFiles(fullPath, recursive));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function expectedFilenames(entry: ParsedEntry, normalizedDoi: string): string[] {
  return Array.from(
    new Set([
      `${getCitationFileStem({ bibtexKey: entry.bibtexKey, doi: normalizedDoi })}.pdf`,
      `${sanitizeFilename(normalizedDoi)}.pdf`,
    ])
  );
}

function normalizeComparable(input: string | undefined): string {
  return (input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantWords(input: string | undefined): string[] {
  return normalizeComparable(input)
    .split(' ')
    .filter((word) => word.length >= 4);
}

function titleMatches(title: string | undefined, text: string): boolean {
  const titleText = normalizeComparable(title);
  if (titleText.length < 10) return false;

  const body = normalizeComparable(text);
  if (body.includes(titleText)) return true;

  const titleWords = significantWords(title);
  if (titleWords.length < 3) return false;

  const bodyWords = new Set(significantWords(text));
  const matched = titleWords.filter((word) => bodyWords.has(word)).length;
  return matched >= Math.ceil(titleWords.length * 0.7);
}

function authorLastNames(authors: string | undefined): string[] {
  if (!authors) return [];

  return Array.from(
    new Set(
      authors
        .split(/\s+and\s+|[,;]/i)
        .map((part) => normalizeComparable(part).split(' ').filter(Boolean).at(-1) ?? '')
        .filter((name) => name.length >= 3)
    )
  );
}

function evidenceFor(
  entry: ParsedEntry,
  normalizedDoi: string,
  pdf: ExtractedPdf
): LocalPaperEvidence {
  const lowerText = pdf.text.toLowerCase();
  const doi = lowerText.includes(normalizedDoi.toLowerCase());
  const title = titleMatches(entry.title, pdf.text);
  const year = entry.year != null && lowerText.includes(String(entry.year));
  const body = normalizeComparable(pdf.text);
  const authors = authorLastNames(entry.authors).filter((author) => body.includes(author));
  const reasons = [
    ...(doi ? ['doi'] : []),
    ...(title ? ['title'] : []),
    ...(year ? ['year'] : []),
    ...authors.map((author) => `author:${author}`),
  ];

  return {
    doi,
    title,
    year,
    authors,
    reasons,
    extractionError: pdf.error,
  };
}

function isStrongEvidence(evidence: LocalPaperEvidence): boolean {
  if (evidence.doi) return true;
  if (evidence.title && (evidence.year || evidence.authors.length > 0)) return true;
  return evidence.title && evidence.authors.length >= 2;
}

function classifyEntry(
  entry: ParsedEntry,
  pdfs: ExtractedPdf[],
  expectedNamesLower: Set<string>,
  expectedNames: string[]
): LocalPaperCheckEntry {
  const label = getCitationDisplayName(entry);

  if (!entry.doi) {
    return {
      bibtexKey: entry.bibtexKey,
      label,
      title: entry.title,
      status: 'skipped',
      expectedFilenames: [],
      candidates: [],
      message: 'No DOI in BibTeX entry; cannot validate local PDF identity.',
    };
  }

  const normalizedDoi = normalizeDoi(entry.doi);
  if (!isValidDoi(normalizedDoi)) {
    return {
      bibtexKey: entry.bibtexKey,
      label,
      doi: normalizedDoi,
      title: entry.title,
      status: 'skipped',
      expectedFilenames: expectedNames,
      candidates: [],
      message: `Invalid DOI in BibTeX entry: ${entry.doi}`,
    };
  }

  const candidates: ScoredCandidate[] = pdfs.map((pdf) => {
    const evidence = evidenceFor(entry, normalizedDoi, pdf);
    return {
      path: pdf.path,
      expectedName: expectedNamesLower.has(path.basename(pdf.path).toLowerCase()),
      evidence,
      strong: isStrongEvidence(evidence),
    };
  });

  const strongCandidates = candidates.filter((candidate) => candidate.strong);
  const expectedCandidates = candidates.filter((candidate) => candidate.expectedName);

  if (strongCandidates.length === 1) {
    const [candidate] = strongCandidates;
    return {
      bibtexKey: entry.bibtexKey,
      label,
      doi: normalizedDoi,
      title: entry.title,
      status: 'matched',
      expectedFilenames: expectedNames,
      pdfPath: candidate.path,
      candidates: [candidate],
      message: `Matched by ${candidate.evidence.reasons.join(', ')}.`,
    };
  }

  if (strongCandidates.length > 1) {
    return {
      bibtexKey: entry.bibtexKey,
      label,
      doi: normalizedDoi,
      title: entry.title,
      status: 'ambiguous',
      expectedFilenames: expectedNames,
      candidates: strongCandidates,
      message: `Multiple local PDFs match this BibTeX entry (${strongCandidates.length}).`,
    };
  }

  if (expectedCandidates.length > 0) {
    return {
      bibtexKey: entry.bibtexKey,
      label,
      doi: normalizedDoi,
      title: entry.title,
      status: 'mismatch',
      expectedFilenames: expectedNames,
      pdfPath: expectedCandidates[0].path,
      candidates: expectedCandidates,
      message: 'Expected filename exists, but extracted text did not confirm DOI/title metadata.',
    };
  }

  return {
    bibtexKey: entry.bibtexKey,
    label,
    doi: normalizedDoi,
    title: entry.title,
    status: 'missing',
    expectedFilenames: expectedNames,
    candidates: [],
    message: `No matching local PDF found. Expected ${expectedNames.join(' or ')}.`,
  };
}

function summarize(entries: LocalPaperCheckEntry[]): LocalPaperCheckSummary {
  return entries.reduce<LocalPaperCheckSummary>(
    (summary, entry) => ({
      ...summary,
      [entry.status]: summary[entry.status] + 1,
    }),
    { total: entries.length, matched: 0, missing: 0, mismatch: 0, ambiguous: 0, skipped: 0 }
  );
}

export async function checkLocalPapers(
  bibtexPath: string,
  options: CheckLocalPapersOptions = {}
): Promise<LocalPaperCheckResult> {
  const resolvedBibtexPath = path.resolve(bibtexPath);
  const bibtexDir = path.dirname(resolvedBibtexPath);
  const paperPath = path.resolve(options.paperPath ?? path.join(bibtexDir, 'papers', 'pdf'));
  const extractText = options.extractText ?? extractPdfMarkdown;

  const parsed = parseBibtex(fs.readFileSync(resolvedBibtexPath, 'utf-8'));
  const pdfPaths = listPdfFiles(paperPath, Boolean(options.recursive));
  const pdfs = await Promise.all(
    pdfPaths.map(async (pdfPath) => {
      try {
        return { path: pdfPath, text: await extractText(pdfPath) };
      } catch (error) {
        return {
          path: pdfPath,
          text: '',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })
  );

  const entries = parsed.map((entry) => {
    const normalizedDoi = entry.doi ? normalizeDoi(entry.doi) : '';
    const names = normalizedDoi ? expectedFilenames(entry, normalizedDoi) : [];
    return classifyEntry(entry, pdfs, new Set(names.map((name) => name.toLowerCase())), names);
  });

  return {
    bibtexPath: resolvedBibtexPath,
    paperPath,
    summary: summarize(entries),
    entries,
  };
}
