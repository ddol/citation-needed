import fs from 'fs';
import pdf2md from '@opendocsg/pdf2md';
import { createLogger } from '../utils/logger';
import { extractPdfLayoutText, repairMarkdownTablesWithLayout } from './layout-tables';

const logger = createLogger('pdf-markdown');

export const PDF_MARKDOWN_EXTRACTOR_NAME = '@opendocsg/pdf2md';

function resolveExtractorVersion(): string {
  try {
    const pkg = require('@opendocsg/pdf2md/package.json') as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export const PDF_MARKDOWN_EXTRACTOR_VERSION = resolveExtractorVersion();

export interface PdfMarkdownExtractor {
  extract(pdfPath: string): Promise<string>;
}

class Pdf2MarkdownExtractor implements PdfMarkdownExtractor {
  async extract(pdfPath: string): Promise<string> {
    const buffer = await fs.promises.readFile(pdfPath);
    return pdf2md(buffer);
  }
}

const defaultExtractor = new Pdf2MarkdownExtractor();

type TableMethod = 'pipe' | 'whitespace';

interface CandidateLine {
  line: string;
  method: TableMethod;
}

interface MarkdownFormatter {
  format(
    markdown: string,
    options: { parser: 'markdown'; proseWrap: 'always'; printWidth: number }
  ): string | Promise<string>;
}

export async function extractPdfMarkdown(pdfPath: string): Promise<string> {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF file not found: ${pdfPath}`);
  }

  const layoutText = await extractPdfLayoutText(pdfPath);
  const firstPass = await formatGeneratedMarkdown(
    repairCaptionBoundaries(
      repairMarkdownHeadings(
        repairMarkdownTablesWithLayout(
          repairMarkdownTables(
            normalizeExtractionArtifacts((await defaultExtractor.extract(pdfPath)).trim())
          ),
          layoutText
        )
      )
    )
  );
  const markdown = await formatGeneratedMarkdown(
    repairMarkdownTablesWithLayout(firstPass, layoutText)
  );
  logger.debug('Extracted PDF markdown', { pdfPath, chars: markdown.length });
  return markdown;
}

export function normalizeExtractionArtifacts(markdown: string): string {
  return Array.from(markdown)
    .map((char) => (char.charCodeAt(0) === 15 ? 'ε' : char))
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 31 || code === 9 || code === 10 || code === 13;
    })
    .join('');
}

export async function formatGeneratedMarkdown(markdown: string): Promise<string> {
  try {
    const prettier = require('prettier') as MarkdownFormatter;
    return (
      await prettier.format(markdown, {
        parser: 'markdown',
        proseWrap: 'always',
        printWidth: 100,
      })
    ).trim();
  } catch (error) {
    logger.warn('Markdown formatting failed; returning unformatted extraction', {
      err: error instanceof Error ? error.message : String(error),
    });
    return markdown;
  }
}

export function repairMarkdownTables(markdown: string): string {
  const repaired: string[] = [];
  let pending: CandidateLine[] = [];
  let inFence = false;

  const flush = (): void => {
    if (pending.length > 0) {
      repaired.push(...repairCandidateBlock(pending));
      pending = [];
    }
  };

  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      flush();
      inFence = !inFence;
      repaired.push(line);
      continue;
    }

    if (inFence) {
      repaired.push(line);
      continue;
    }

    const candidate = classifyCandidateLine(line);
    if (!candidate) {
      flush();
      repaired.push(line);
      continue;
    }

    if (pending.length > 0 && pending[0].method !== candidate.method) {
      flush();
    }
    pending.push(candidate);
  }

  flush();
  return repaired.join('\n');
}

export function repairMarkdownHeadings(markdown: string): string {
  const lines = markdown.split('\n');
  let seenAbstract = false;

  return lines
    .map((line) => {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (!match) return line;

      const level = match[1].length;
      const text = match[2].trim();
      const normalizedText = text.replace(/\s+/g, ' ');
      const isAbstractHeading = /^abstract\b/i.test(normalizedText);

      if (isAbstractHeading) {
        seenAbstract = true;
        const abstractBody = normalizedText.match(/^Abstract[—-]\s*(.+)$/i)?.[1];
        return abstractBody ? `## Abstract\n\n${abstractBody}` : '## Abstract';
      }

      const allCapsHeadingLevel = normalizedAllCapsHeadingLevel(level, normalizedText);
      if (allCapsHeadingLevel !== undefined) {
        return `${'#'.repeat(allCapsHeadingLevel)} ${normalizedText}`;
      }

      if (
        isFormulaOrFigureHeading(normalizedText) ||
        isProseHeading(level, normalizedText) ||
        (!seenAbstract && level >= 3 && !isAbstractHeading && !isNumberedSection(normalizedText))
      ) {
        return normalizedText;
      }

      const normalizedLevel = normalizedHeadingLevel(level, normalizedText);
      return `${'#'.repeat(normalizedLevel)} ${normalizedText}`;
    })
    .join('\n');
}

export function repairCaptionBoundaries(markdown: string): string {
  const repaired: string[] = [];
  let inFence = false;

  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      repaired.push(line);
      continue;
    }

    if (inFence) {
      repaired.push(line);
      continue;
    }

    const split = splitEmbeddedCaption(line);
    repaired.push(...split);
  }

  return repaired.join('\n');
}

function splitEmbeddedCaption(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [line];
  if (/^(?:Table|Tab\.?|Figure|Fig\.?|Chart)\s+\d+\s*[:.]/i.test(trimmed)) return [line];

  const match = line.match(/\b(?:Table|Tab\.?|Figure|Fig\.?|Chart)\s+\d+\s*[:.]/i);
  if (!match || match.index === undefined || match.index < 20) return [line];

  const prefix = line.slice(0, match.index).trimEnd();
  const caption = line.slice(match.index).trimStart();
  if (!prefix || !caption) return [line];
  if (!/[.!?)]$/.test(prefix) && prefix.length < 80) return [line];

  return [prefix, '', caption];
}

function classifyCandidateLine(line: string): CandidateLine | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 180) return null;
  if (/^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|!\[|\[|<!--)/.test(trimmed)) return null;

  if (/^\||\|$|\s\|\s/.test(trimmed)) {
    const cells = splitPipeCells(trimmed);
    if (cells.length >= 2 && cells.every((cell) => cell.length <= 80)) {
      return { line, method: 'pipe' };
    }
  }

  if (trimmed.includes('\t') || /\S\s{2,}\S/.test(trimmed)) {
    const cells = splitWhitespaceCells(trimmed);
    if (
      cells.length >= 2 &&
      cells.every((cell) => cell.length > 0 && cell.length <= 80) &&
      !looksLikeProseLine(trimmed, cells)
    ) {
      return { line, method: 'whitespace' };
    }
  }

  return null;
}

function repairCandidateBlock(block: CandidateLine[]): string[] {
  if (block.length < 2) return block.map((candidate) => candidate.line);

  const rows =
    block[0].method === 'pipe'
      ? block.map((candidate) => splitPipeCells(candidate.line.trim()))
      : block.map((candidate) => splitWhitespaceCells(candidate.line.trim()));

  const normalizedRows = rows.filter((row) => !isSeparatorRow(row)).map(normalizeCells);
  if (normalizedRows.length < 2) return block.map((candidate) => candidate.line);

  const width = normalizedRows[0].length;
  if (width < 2 || normalizedRows.some((row) => row.length !== width)) {
    return block.map((candidate) => candidate.line);
  }

  return [
    formatMarkdownRow(normalizedRows[0]),
    formatMarkdownRow(Array.from({ length: width }, () => '---')),
    ...normalizedRows.slice(1).map(formatMarkdownRow),
  ];
}

function splitPipeCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function splitWhitespaceCells(line: string): string[] {
  return line.includes('\t')
    ? line.split(/\t+/).map((cell) => cell.trim())
    : line.split(/\s{2,}/).map((cell) => cell.trim());
}

function normalizeCells(cells: string[]): string[] {
  return cells.map((cell) => cell.replace(/\s+/g, ' ').trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function formatMarkdownRow(cells: string[]): string {
  return `| ${cells.map(escapeTableCell).join(' | ')} |`;
}

function escapeTableCell(cell: string): string {
  return cell.replace(/\\?\|/g, (match) => (match === '\\|' ? match : '\\|'));
}

function looksLikeProseLine(line: string, cells: string[]): boolean {
  const wordCount = line.split(/\s+/).filter(Boolean).length;
  const hasSentenceEnding = /[.!?]\s*$/.test(line);
  return hasSentenceEnding && wordCount > cells.length * 3;
}

function isFormulaOrFigureHeading(text: string): boolean {
  const plain = text.replace(/[*_`]/g, '').trim();
  if (/^(?:gt|[A-Z])\s*[:.]$/i.test(plain)) return true;
  if (/^\(?\d+\)?$/.test(plain)) return true;
  if (/^[A-Z0-9,./ -]+$/.test(plain) && /[,/]/.test(plain)) return true;
  if (!/[A-Za-z]{3,}/.test(plain)) return true;
  if (isNumberedSection(plain)) return false;

  const mathTokens = (plain.match(/[∑√∫≈≤≥±−=|{}[\]()]/g) ?? []).length;
  const words = plain.split(/\s+/).filter((word) => /[A-Za-z]{3,}/.test(word)).length;
  return mathTokens >= 1 && words <= 2;
}

function normalizedHeadingLevel(currentLevel: number, text: string): number {
  if (/^(?:abstract|references)\b/i.test(text)) return 2;
  if (/^[A-Z]\.\s+\S/.test(text)) return 2;
  if (/^[IVX]+\.\s+\S/.test(text)) return 2;
  if (/^S\.\d+\.?\s+\S/i.test(text)) return 2;
  if (/^\d+\.\d+\.?\s+\S/.test(text)) return 3;
  if (/^\d+\.\s+\S/.test(text)) return 2;
  return currentLevel;
}

function isNumberedSection(text: string): boolean {
  return /^(?:\d+\.\s+\S|\d+(?:\.\d+)+\.?\s+\S|[A-Z]\.\s+\S|[IVX]+\.\s+\S)/.test(text);
}

function isProseHeading(level: number, text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean);
  if (isNumberedSection(text)) return false;
  if (level >= 4 && (/^[a-z]/.test(text) || /[.!?]$/.test(text))) return true;
  if (level >= 4 && words.length >= 5) return true;
  return level <= 2 && /^\d+\s+\S/.test(text) && words.length >= 6;
}

function normalizedAllCapsHeadingLevel(level: number, text: string): number | undefined {
  if (level > 4) return undefined;
  if (/^(?:[A-Z][A-Z0-9 -]{3,}|S\.\d+\.?\s+[A-Z0-9 -]+)$/.test(text)) return 2;
  return undefined;
}
