import fs from 'fs';
import path from 'path';
import type { Citation } from '../models/citation';
import type { Database } from '../db/index';
import { getDatabase } from '../db/index';
import { sanitizeFilename } from '../utils/file';
import { resolveMarkdownPath } from './markdown-locator';
import { extractPdfLayoutText } from '../verification/layout-tables';

export interface MarkdownQualityOptions {
  db?: Database;
  doi?: string;
  limit?: number;
  paperPath?: string;
  markdownPath?: string;
  recursive?: boolean;
  readPdfLayout?: (pdfPath: string) => Promise<string | undefined>;
}

export interface SourceTablePage {
  page: number;
  count: number;
  tableNumbers: string[];
}

export interface HeadingIssue {
  line: number;
  message: string;
}

export interface MarkdownQualityMetrics {
  score: number;
  sourcePages: number;
  markdownPages: number;
  pageBreakScore: number;
  sourceTableCount: number;
  markdownTableCount: number;
  tableCoverageScore: number;
  tableFormattingScore: number;
  headingFlowScore: number;
  arxivPlacementScore: number;
  completenessScore: number;
  artifactScore: number;
  sourceWordCount: number;
  markdownWordCount: number;
}

export interface MarkdownQualityPaper {
  id: string;
  doi?: string;
  title?: string;
  pdfPath: string;
  markdownPath?: string;
  sourceTablesByPage: SourceTablePage[];
  sourceTableNumbers: string[];
  markdownTableNumbers: string[];
  missingMarkdownTables: string[];
  headingIssues: HeadingIssue[];
  issues: string[];
  metrics: MarkdownQualityMetrics;
}

export interface MarkdownQualitySummary {
  papers: number;
  scored: number;
  missingMarkdown: number;
  missingPdf: number;
  averageScore: number;
  totalSourceTables: number;
  totalMissingMarkdownTables: number;
}

export interface MarkdownQualityReport {
  summary: MarkdownQualitySummary;
  papers: MarkdownQualityPaper[];
}

interface PaperInput {
  id: string;
  doi?: string;
  title?: string;
  pdfPath: string;
  markdownPath?: string;
}

interface MarkdownTable {
  startLine: number;
  endLine: number;
  columns: number;
  valid: boolean;
}

const TABLE_CAPTION_RE = /\b(?:Table|Tab\.?)\s+(\d+)(?:\s*[:.]|\b)/i;
const ARXIV_RE = /\barXiv\s*:\s*\d{4}\.\d{4,5}(?:v\d+)?/i;
const TABLE_ROW_SEPARATOR_RE = /\t+| {2,}/;

export async function scoreMarkdownQuality(
  options: MarkdownQualityOptions = {}
): Promise<MarkdownQualityReport> {
  const readPdfLayout = options.readPdfLayout ?? extractPdfLayoutText;
  const inputs = collectInputs(options);
  const papers: MarkdownQualityPaper[] = [];

  for (const input of inputs) {
    // eslint-disable-next-line no-await-in-loop
    papers.push(await scorePaper(input, readPdfLayout));
  }

  const scored = papers.filter((paper) => paper.markdownPath && fs.existsSync(paper.markdownPath));
  const missingMarkdown = papers.filter(
    (paper) => !paper.markdownPath || !fs.existsSync(paper.markdownPath)
  ).length;
  const missingPdf = papers.filter((paper) => !fs.existsSync(paper.pdfPath)).length;
  const totalScore = scored.reduce((sum, paper) => sum + paper.metrics.score, 0);
  const totalSourceTables = papers.reduce((sum, paper) => sum + paper.metrics.sourceTableCount, 0);
  const totalMissingMarkdownTables = papers.reduce(
    (sum, paper) => sum + paper.missingMarkdownTables.length,
    0
  );

  return {
    summary: {
      papers: papers.length,
      scored: scored.length,
      missingMarkdown,
      missingPdf,
      averageScore: scored.length > 0 ? round(totalScore / scored.length) : 0,
      totalSourceTables,
      totalMissingMarkdownTables,
    },
    papers,
  };
}

function collectInputs(options: MarkdownQualityOptions): PaperInput[] {
  if (options.paperPath || options.markdownPath) {
    if (!options.paperPath || !options.markdownPath) {
      throw new Error(
        'Pass both --paper-path and --markdown-path, or neither to use the DB corpus.'
      );
    }
    return collectFolderInputs(options.paperPath, options.markdownPath, Boolean(options.recursive));
  }

  const db = options.db ?? getDatabase();
  const citations = getCitations(db, options.doi).slice(0, options.limit);
  return citations.map((citation) => ({
    id: citation.doi,
    doi: citation.doi,
    title: citation.title,
    pdfPath: citation.pdfPath ?? '',
    markdownPath: resolveMarkdownPath(citation, db) ?? undefined,
  }));
}

function getCitations(db: Database, doi?: string): Citation[] {
  if (doi) {
    const citation = db.getCitation(doi);
    return citation ? [citation] : [];
  }
  return db.getAllCitations();
}

function collectFolderInputs(
  paperPath: string,
  markdownPath: string,
  recursive: boolean
): PaperInput[] {
  const pdfRoot = path.resolve(paperPath);
  const markdownRoot = path.resolve(markdownPath);
  return listPdfFiles(pdfRoot, recursive).map((pdfPath) => {
    const relative = path.relative(pdfRoot, pdfPath);
    const markdownRelative = relative.replace(/\.pdf$/i, '.md');
    const markdownCandidate = path.join(markdownRoot, markdownRelative);
    const fallbackMarkdown = path.join(
      markdownRoot,
      `${sanitizeFilename(path.basename(pdfPath, path.extname(pdfPath)))}.md`
    );
    return {
      id: path.basename(pdfPath, path.extname(pdfPath)),
      pdfPath,
      markdownPath: fs.existsSync(markdownCandidate) ? markdownCandidate : fallbackMarkdown,
    };
  });
}

function listPdfFiles(root: string, recursive: boolean): string[] {
  if (!fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory() && recursive) {
      files.push(...listPdfFiles(fullPath, true));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

async function scorePaper(
  input: PaperInput,
  readPdfLayout: (pdfPath: string) => Promise<string | undefined>
): Promise<MarkdownQualityPaper> {
  const issues: string[] = [];
  let layoutText: string | undefined;

  if (!input.pdfPath || !fs.existsSync(input.pdfPath)) {
    issues.push('missing-pdf');
  } else {
    layoutText = await readPdfLayout(input.pdfPath);
    if (!layoutText) issues.push('source-layout-unavailable');
  }

  const markdown =
    input.markdownPath && fs.existsSync(input.markdownPath)
      ? fs.readFileSync(input.markdownPath, 'utf-8')
      : undefined;
  if (!markdown) issues.push('missing-markdown');

  const sourcePages = splitPages(layoutText);
  const sourceTablesByPage = sourcePages.map((pageText, index) =>
    sourceTablesForPage(pageText, index + 1)
  );
  const sourceTableNumbers = sourceTablesByPage.flatMap((page) => page.tableNumbers);
  const sourceTableCount = sourceTablesByPage.reduce((sum, page) => sum + page.count, 0);
  const markdownTableNumbers = markdown ? markdownTableCaptionsWithTables(markdown) : [];
  const markdownTables = markdown ? findMarkdownTables(markdown) : [];
  const missingMarkdownTables = sourceTableNumbers.filter(
    (tableNumber) => !markdownTableNumbers.includes(tableNumber)
  );
  const headingIssues = markdown ? scoreHeadings(markdown).issues : [];

  if (missingMarkdownTables.length > 0) {
    issues.push(`missing-markdown-tables:${missingMarkdownTables.join(',')}`);
  }
  if (headingIssues.length > 0) issues.push('heading-flow-issues');

  const metrics = buildMetrics({
    sourcePages,
    sourceTableCount,
    sourceTableNumbers,
    markdown,
    markdownTables,
    markdownTableNumbers,
    missingMarkdownTables,
    headingIssues,
  });

  return {
    id: input.id,
    doi: input.doi,
    title: input.title,
    pdfPath: input.pdfPath,
    markdownPath: input.markdownPath,
    sourceTablesByPage,
    sourceTableNumbers,
    markdownTableNumbers,
    missingMarkdownTables,
    headingIssues,
    issues,
    metrics,
  };
}

function splitPages(layoutText?: string): string[] {
  if (!layoutText) return [];
  return layoutText
    .split('\f')
    .map((page) => page.trimEnd())
    .filter((page) => page.trim().length > 0);
}

function sourceTablesForPage(pageText: string, page: number): SourceTablePage {
  const tableNumbers = tableCaptionsForText(pageText);
  if (tableNumbers.length === 0 && looksLikeReferencesPage(pageText)) {
    return { page, count: 0, tableNumbers };
  }
  const tableBlocks = countSourceTableBlocks(pageText);
  return { page, count: Math.max(tableNumbers.length, tableBlocks), tableNumbers };
}

function looksLikeReferencesPage(pageText: string): boolean {
  const lines = pageText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const startsWithReferences = lines.slice(0, 5).some((line) => /^references\b/i.test(line));
  const referenceRows = lines.filter((line) => /^\[\d+\]/.test(line)).length;
  return startsWithReferences && referenceRows >= 3;
}

function tableCaptionsForText(text: string): string[] {
  const captions: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const match = trimmed.match(TABLE_CAPTION_RE);
    if (!match) continue;
    if (
      /^(?:Table|Tab\.?)\s+\d+/i.test(trimmed) ||
      /^\*{0,2}(?:Table|Tab\.?)\s+\d+/i.test(trimmed)
    ) {
      captions.push(match[1]);
    }
  }

  return captions;
}

function countSourceTableBlocks(pageText: string): number {
  const lines = pageText.split(/\r?\n/);
  let count = 0;
  let block: string[][] = [];

  const flush = (): void => {
    if (isSourceTableBlock(block)) count += 1;
    block = [];
  };

  for (const line of lines) {
    const cells = sourceTableCells(line);
    if (cells.length >= 2 && !looksLikeSourceProse(cells)) {
      block.push(cells);
    } else {
      flush();
    }
  }
  flush();

  return count;
}

function sourceTableCells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed || /\b(?:Table|Figure)\s+\d+\s*:/.test(trimmed)) return [];
  if (/^\|.*\|$/.test(trimmed)) return splitMarkdownTableRow(trimmed);
  return trimmed
    .split(TABLE_ROW_SEPARATOR_RE)
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function isSourceTableBlock(rows: string[][]): boolean {
  if (rows.length < 3) return false;

  const widths = new Map<number, number>();
  let numericRows = 0;
  let numericTokens = 0;
  let wordTokens = 0;
  for (const row of rows) {
    widths.set(row.length, (widths.get(row.length) ?? 0) + 1);
    if (row.some((cell) => /\d/.test(cell))) numericRows += 1;
    const text = row.join(' ');
    numericTokens += (text.match(/\d+(?:\.\d+)?/g) ?? []).length;
    wordTokens += text.split(/\s+/).filter(Boolean).length;
  }

  const stableWidths = Array.from(widths.entries()).filter(
    ([width, occurrences]) => width >= 2 && occurrences >= 3
  );
  if (stableWidths.length === 0 || numericRows < Math.ceil(rows.length / 2)) return false;

  const [dominantWidth] = stableWidths.sort((a, b) => b[1] - a[1])[0];
  const averageWordsPerRow = wordTokens / rows.length;
  const numericDensity = numericTokens / Math.max(1, wordTokens);
  if (dominantWidth <= 2 && averageWordsPerRow > 8 && numericDensity < 0.35) return false;

  return true;
}

function looksLikeSourceProse(cells: string[]): boolean {
  const text = cells.join(' ');
  const words = text.split(/\s+/).filter(Boolean);
  const numericTokens = (text.match(/\d+(?:\.\d+)?/g) ?? []).length;
  return words.length >= 14 && numericTokens < 3;
}

function markdownTableCaptionsWithTables(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const tableNumbers: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/\b(?:Table|Tab\.?)\s+(\d+)(?:\s*[:.]|\b)/i);
    if (!match) continue;

    const previous = previousNonEmptyLine(lines, i);
    if (previous !== undefined && isInsideMarkdownTable(lines, previous)) {
      tableNumbers.push(match[1]);
    }
  }

  return tableNumbers;
}

function findMarkdownTables(markdown: string): MarkdownTable[] {
  const lines = markdown.split(/\r?\n/);
  const tables: MarkdownTable[] = [];

  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!isPipeRow(lines[i]) || !isSeparatorRow(lines[i + 1])) continue;

    const startLine = i + 1;
    const columns = splitMarkdownTableRow(lines[i]).length;
    let end = i + 1;
    while (end + 1 < lines.length && isPipeRow(lines[end + 1])) end += 1;

    const rows = lines.slice(i, end + 1).map(splitMarkdownTableRow);
    const valid = columns >= 2 && rows.every((row) => row.length === columns);
    tables.push({ startLine, endLine: end + 1, columns, valid });
    i = end;
  }

  return tables;
}

function isInsideMarkdownTable(lines: string[], lineIndex: number): boolean {
  for (let i = lineIndex; i >= 0 && isPipeRow(lines[i]); i -= 1) {
    if (i > 0 && isSeparatorRow(lines[i])) return true;
  }
  return false;
}

function isPipeRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isSeparatorRow(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

function previousNonEmptyLine(lines: string[], fromIndex: number): number | undefined {
  for (let i = fromIndex - 1; i >= 0; i -= 1) {
    if (lines[i].trim()) return i;
  }
  return undefined;
}

function scoreHeadings(markdown: string): { score: number; issues: HeadingIssue[] } {
  const headings = markdown
    .split(/\r?\n/)
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => /^#{1,6}\s+\S/.test(line))
    .map(({ line, index }) => ({
      line: index,
      level: line.match(/^#+/)?.[0].length ?? 0,
      text: line.replace(/^#{1,6}\s+/, '').trim(),
    }));

  const issues: HeadingIssue[] = [];
  let score = 1;

  for (let i = 1; i < headings.length; i += 1) {
    const jump = headings[i].level - headings[i - 1].level;
    if (jump > 1) {
      score -= 0.12;
      issues.push({
        line: headings[i].line,
        message: `heading jumps from h${headings[i - 1].level} to h${headings[i].level}`,
      });
    }
  }

  for (let i = 0; i < headings.length; i += 1) {
    const block = headings.slice(i, i + 4);
    if (block.length >= 4 && block.every((heading) => heading.level === 3)) {
      score -= 0.25;
      issues.push({
        line: block[0].line,
        message: 'four consecutive h3 headings look like metadata, not document structure',
      });
      break;
    }
  }

  const numericOrSymbolHeadings = headings.filter((heading) => !/[a-z]{3,}/i.test(heading.text));
  if (numericOrSymbolHeadings.length > 0) {
    score -= Math.min(0.2, numericOrSymbolHeadings.length * 0.04);
    for (const heading of numericOrSymbolHeadings.slice(0, 3)) {
      issues.push({ line: heading.line, message: 'heading has little natural-language content' });
    }
  }

  return { score: clamp(score), issues };
}

function buildMetrics(args: {
  sourcePages: string[];
  sourceTableCount: number;
  sourceTableNumbers: string[];
  markdown?: string;
  markdownTables: MarkdownTable[];
  markdownTableNumbers: string[];
  missingMarkdownTables: string[];
  headingIssues: HeadingIssue[];
}): MarkdownQualityMetrics {
  const { sourceTableCount } = args;
  const markdown = args.markdown ?? '';
  const sourceWordCount = wordCount(args.sourcePages.join('\n'));
  const markdownWordCount = wordCount(stripMarkdownSyntax(markdown));
  const sourcePages = args.sourcePages.length;
  const markdownPages = markdown ? markdown.split(/<!--\s*PAGE_BREAK\s*-->/i).length : 0;
  const markdownTableCount = args.markdownTables.length;
  const validTables = args.markdownTables.filter((table) => table.valid).length;
  const tableFormattingScore = markdownTableCount === 0 ? 1 : validTables / markdownTableCount;
  const headingFlowScore = scoreHeadings(markdown).score;
  const artifactScore = scoreArtifacts(markdown);

  if (!markdown) {
    return {
      score: 0,
      sourcePages,
      markdownPages,
      pageBreakScore: 0,
      sourceTableCount,
      markdownTableCount,
      tableCoverageScore: 0,
      tableFormattingScore: 0,
      headingFlowScore: 0,
      arxivPlacementScore: 0,
      completenessScore: 0,
      artifactScore: 0,
      sourceWordCount,
      markdownWordCount,
    };
  }

  if (sourcePages === 0) {
    return {
      score: round(
        100 * (0.14 * tableFormattingScore + 0.18 * headingFlowScore + 0.08 * artifactScore)
      ),
      sourcePages,
      markdownPages,
      pageBreakScore: 0,
      sourceTableCount,
      markdownTableCount,
      tableCoverageScore: 0,
      tableFormattingScore: round(tableFormattingScore),
      headingFlowScore: round(headingFlowScore),
      arxivPlacementScore: 0,
      completenessScore: 0,
      artifactScore: round(artifactScore),
      sourceWordCount,
      markdownWordCount,
    };
  }

  const matchedNumberedTables = args.sourceTableNumbers.length - args.missingMarkdownTables.length;
  const unnumberedSourceTables = Math.max(0, sourceTableCount - args.sourceTableNumbers.length);
  const unnumberedMarkdownTables = Math.max(
    0,
    markdownTableCount - args.markdownTableNumbers.length
  );
  const inferredUnnumberedMatches = Math.min(unnumberedSourceTables, unnumberedMarkdownTables);
  const tableCoverageScore =
    sourceTableCount === 0
      ? 1
      : (matchedNumberedTables + inferredUnnumberedMatches) / sourceTableCount;
  const arxivPlacementScore = scoreArxivPlacement(args.sourcePages, markdown);
  const pageBreakScore =
    sourcePages <= 1 || markdownPages === 0
      ? 1
      : clamp(1 - Math.abs(sourcePages - markdownPages) / sourcePages);
  const completenessScore =
    sourceWordCount === 0 || markdownWordCount === 0
      ? 0
      : clamp(Math.min(markdownWordCount / sourceWordCount, sourceWordCount / markdownWordCount));
  const score = round(
    100 *
      (0.28 * tableCoverageScore +
        0.14 * tableFormattingScore +
        0.18 * headingFlowScore +
        0.12 * arxivPlacementScore +
        0.1 * pageBreakScore +
        0.1 * completenessScore +
        0.08 * artifactScore)
  );

  return {
    score,
    sourcePages,
    markdownPages,
    pageBreakScore: round(pageBreakScore),
    sourceTableCount,
    markdownTableCount,
    tableCoverageScore: round(tableCoverageScore),
    tableFormattingScore: round(tableFormattingScore),
    headingFlowScore: round(headingFlowScore),
    arxivPlacementScore: round(arxivPlacementScore),
    completenessScore: round(completenessScore),
    artifactScore: round(artifactScore),
    sourceWordCount,
    markdownWordCount,
  };
}

function scoreArxivPlacement(sourcePages: string[], markdown: string): number {
  const sourceHasArxiv = sourcePages.some((page) => ARXIV_RE.test(page));
  if (!sourceHasArxiv) return 1;

  const lines = markdown.split(/\r?\n/);
  const arxivLineIndex = lines.findIndex((line) => ARXIV_RE.test(line));
  if (arxivLineIndex < 0) return 0;

  const firstPageBreak = lines.findIndex((line) => /<!--\s*PAGE_BREAK\s*-->/i.test(line));
  const isFirstPage = firstPageBreak < 0 || arxivLineIndex < firstPageBreak;
  if (!isFirstPage) return 0.35;

  const nonEmptyBefore = lines.slice(0, arxivLineIndex).filter((line) => line.trim()).length;
  if (nonEmptyBefore <= 8) return 1;
  if (nonEmptyBefore <= 25) return 0.75;
  return 0.5;
}

function scoreArtifacts(markdown: string): number {
  if (!markdown) return 0;
  const lines = markdown.split(/\r?\n/);
  const controlChars = Array.from(markdown).filter((char) => {
    const code = char.charCodeAt(0);
    return (code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31);
  }).length;
  const collapsedTableLines = lines.filter((line) => {
    const numericTokens = (line.match(/\d+(?:\.\d+)?/g) ?? []).length;
    return line.length > 250 && numericTokens >= 12 && !line.trim().startsWith('|');
  }).length;
  const pageBreaks = lines.filter((line) => /<!--\s*PAGE_BREAK\s*-->/i.test(line)).length;
  const malformedPageBreaks = lines.filter(
    (line) => /PAGE_BREAK/i.test(line) && !/^\s*<!--\s*PAGE_BREAK\s*-->\s*$/.test(line)
  ).length;

  return clamp(
    1 -
      controlChars * 0.05 -
      collapsedTableLines * 0.15 -
      malformedPageBreaks * 0.1 -
      (pageBreaks === 0 ? 0.05 : 0)
  );
}

function wordCount(text: string): number {
  return (text.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/g) ?? []).length;
}

function stripMarkdownSyntax(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/[`*_#[\]()>|:-]/g, ' ')
    .replace(/\s+/g, ' ');
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
