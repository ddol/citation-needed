import fs from 'fs';
import pdf2md from '@opendocsg/pdf2md';
import { createLogger } from '../utils/logger';

const logger = createLogger('pdf-markdown');

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

export async function extractPdfMarkdown(pdfPath: string): Promise<string> {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF file not found: ${pdfPath}`);
  }

  const markdown = repairMarkdownTables((await defaultExtractor.extract(pdfPath)).trim());
  logger.debug('Extracted PDF markdown', { pdfPath, chars: markdown.length });
  return markdown;
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
