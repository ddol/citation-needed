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

export interface SourceNumberedPage {
  page: number;
  count: number;
  numbers: string[];
}

export interface HeadingIssue {
  line: number;
  message: string;
}

export interface AgentReadabilityIssue {
  line?: number;
  severity: 'low' | 'medium' | 'high';
  message: string;
  suggestion: string;
}

export interface EquationRenderIssue {
  line: number;
  number?: string;
  message: string;
}

export interface EquationEvidence {
  number: string;
  text: string;
  normalizedText: string;
  placeholder: boolean;
  githubDisplayMath: boolean;
  page?: number;
  line?: number;
}

export interface EquationComparison {
  number: string;
  presentInMarkdown: boolean;
  githubDisplayMath: boolean;
  placeholderOnly: boolean;
  contentSimilarity: number;
  status: 'matched' | 'placeholder' | 'format-issue' | 'content-mismatch' | 'missing';
  sourcePage?: number;
  sourceText?: string;
  markdownText?: string;
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
  sourceChartCount: number;
  markdownChartCount: number;
  chartCoverageScore: number;
  sourceEquationCount: number;
  markdownEquationCount: number;
  equationCoverageScore: number;
  equationFormatScore: number;
  equationContentScore: number;
  equationRenderScore: number;
  sourceReferenceCount: number;
  markdownReferenceCount: number;
  referenceCoverageScore: number;
  headingFlowScore: number;
  arxivPlacementScore: number;
  completenessScore: number;
  artifactScore: number;
  agentReadabilityScore: number;
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
  sourceChartsByPage: SourceNumberedPage[];
  sourceChartNumbers: string[];
  markdownChartNumbers: string[];
  missingMarkdownCharts: string[];
  sourceEquationsByPage: SourceNumberedPage[];
  sourceEquationNumbers: string[];
  markdownEquationNumbers: string[];
  missingMarkdownEquations: string[];
  equationComparisons: EquationComparison[];
  malformedMarkdownEquations: string[];
  placeholderMarkdownEquations: string[];
  lowSimilarityMarkdownEquations: string[];
  equationRenderIssues: EquationRenderIssue[];
  sourceReferenceCount: number;
  markdownReferenceCount: number;
  headingIssues: HeadingIssue[];
  agentReadabilityIssues: AgentReadabilityIssue[];
  parserImprovementSuggestions: string[];
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
  totalSourceCharts: number;
  totalMissingMarkdownCharts: number;
  totalSourceEquations: number;
  totalMissingMarkdownEquations: number;
  totalMalformedMarkdownEquations: number;
  totalPlaceholderMarkdownEquations: number;
  totalLowSimilarityMarkdownEquations: number;
  totalEquationRenderIssues: number;
  totalSourceReferences: number;
  totalMarkdownReferences: number;
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
const CHART_CAPTION_RE = /\b(?:Figure|Fig\.?|Chart)\s+(\d+)(?:\s*[:.]|\b)/i;
const EQUATION_NUMBER_RE = /(?:^|[\s,.;])\((\d{1,3})\)(?:\s*where\b.*)?\s*$/i;
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
  const totalSourceCharts = papers.reduce((sum, paper) => sum + paper.metrics.sourceChartCount, 0);
  const totalMissingMarkdownCharts = papers.reduce(
    (sum, paper) => sum + paper.missingMarkdownCharts.length,
    0
  );
  const totalSourceEquations = papers.reduce(
    (sum, paper) => sum + paper.metrics.sourceEquationCount,
    0
  );
  const totalMissingMarkdownEquations = papers.reduce(
    (sum, paper) => sum + paper.missingMarkdownEquations.length,
    0
  );
  const totalMalformedMarkdownEquations = papers.reduce(
    (sum, paper) => sum + paper.malformedMarkdownEquations.length,
    0
  );
  const totalPlaceholderMarkdownEquations = papers.reduce(
    (sum, paper) => sum + paper.placeholderMarkdownEquations.length,
    0
  );
  const totalLowSimilarityMarkdownEquations = papers.reduce(
    (sum, paper) => sum + paper.lowSimilarityMarkdownEquations.length,
    0
  );
  const totalEquationRenderIssues = papers.reduce(
    (sum, paper) => sum + paper.equationRenderIssues.length,
    0
  );
  const totalSourceReferences = papers.reduce(
    (sum, paper) => sum + paper.metrics.sourceReferenceCount,
    0
  );
  const totalMarkdownReferences = papers.reduce(
    (sum, paper) => sum + paper.metrics.markdownReferenceCount,
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
      totalSourceCharts,
      totalMissingMarkdownCharts,
      totalSourceEquations,
      totalMissingMarkdownEquations,
      totalMalformedMarkdownEquations,
      totalPlaceholderMarkdownEquations,
      totalLowSimilarityMarkdownEquations,
      totalEquationRenderIssues,
      totalSourceReferences,
      totalMarkdownReferences,
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
  const sourceTableNumbers = unique(sourceTablesByPage.flatMap((page) => page.tableNumbers));
  const sourceTableCount = sourceTablesByPage.reduce((sum, page) => sum + page.count, 0);
  const sourceChartsByPage = sourcePages.map((pageText, index) =>
    sourceNumberedItemsForPage(pageText, index + 1, CHART_CAPTION_RE)
  );
  const sourceChartNumbers = unique(sourceChartsByPage.flatMap((page) => page.numbers));
  const sourceEquationEvidence = sourcePages.flatMap((pageText, index) =>
    sourceEquationEvidenceForPage(pageText, index + 1)
  );
  const sourceEquationsByPage = sourcePages.map((pageText, index) =>
    sourceEquationsForPage(pageText, index + 1)
  );
  const sourceEquationNumbers = unique(sourceEquationEvidence.map((equation) => equation.number));
  const sourceReferenceCount = countReferences(layoutText ?? '');
  const markdownTableNumbers = markdown ? unique(markdownTableCaptionsWithTables(markdown)) : [];
  const markdownTables = markdown ? findMarkdownTables(markdown) : [];
  const markdownChartNumbers = markdown
    ? unique(markdownNumberedItems(markdown, CHART_CAPTION_RE))
    : [];
  const markdownEquationEvidence = markdown ? markdownEquationEvidenceForText(markdown) : [];
  const markdownEquationNumbers = unique(
    markdownEquationEvidence.map((equation) => equation.number)
  );
  const markdownReferenceCount = markdown ? countReferences(markdown) : 0;
  const missingMarkdownTables = sourceTableNumbers.filter(
    (tableNumber) => !markdownTableNumbers.includes(tableNumber)
  );
  const missingMarkdownCharts = sourceChartNumbers.filter(
    (chartNumber) => !markdownChartNumbers.includes(chartNumber)
  );
  const missingMarkdownEquations = sourceEquationNumbers.filter(
    (equationNumber) => !markdownEquationNumbers.includes(equationNumber)
  );
  const equationComparisons = compareEquations(sourceEquationEvidence, markdownEquationEvidence);
  const malformedMarkdownEquations = comparisonNumbers(equationComparisons, 'format-issue');
  const placeholderMarkdownEquations = comparisonNumbers(equationComparisons, 'placeholder');
  const lowSimilarityMarkdownEquations = comparisonNumbers(equationComparisons, 'content-mismatch');
  const equationRenderIssues = markdown ? assessEquationRenderability(markdown) : [];
  const headingIssues = markdown ? scoreHeadings(markdown).issues : [];
  const agentReadabilityIssues = markdown ? assessAgentReadability(markdown) : [];
  const parserImprovementSuggestions = parserSuggestions({
    missingMarkdownTables,
    missingMarkdownCharts,
    missingMarkdownEquations,
    malformedMarkdownEquations,
    placeholderMarkdownEquations,
    lowSimilarityMarkdownEquations,
    equationRenderIssues,
    sourceReferenceCount,
    markdownReferenceCount,
    agentReadabilityIssues,
    headingIssues,
  });

  if (missingMarkdownTables.length > 0) {
    issues.push(`missing-markdown-tables:${missingMarkdownTables.join(',')}`);
  }
  if (missingMarkdownCharts.length > 0) {
    issues.push(`missing-markdown-charts:${missingMarkdownCharts.join(',')}`);
  }
  if (missingMarkdownEquations.length > 0) {
    issues.push(`missing-markdown-equations:${missingMarkdownEquations.join(',')}`);
  }
  if (malformedMarkdownEquations.length > 0) {
    issues.push(`malformed-markdown-equations:${malformedMarkdownEquations.join(',')}`);
  }
  if (placeholderMarkdownEquations.length > 0) {
    issues.push(`placeholder-markdown-equations:${placeholderMarkdownEquations.join(',')}`);
  }
  if (lowSimilarityMarkdownEquations.length > 0) {
    issues.push(`low-similarity-markdown-equations:${lowSimilarityMarkdownEquations.join(',')}`);
  }
  if (equationRenderIssues.length > 0) {
    issues.push(`equation-render-issues:${equationRenderIssues.length}`);
  }
  if (sourceReferenceCount > 0 && markdownReferenceCount < sourceReferenceCount) {
    issues.push(`missing-references:${sourceReferenceCount - markdownReferenceCount}`);
  }
  if (headingIssues.length > 0) issues.push('heading-flow-issues');
  if (agentReadabilityIssues.length > 0) issues.push('agent-readability-issues');

  const metrics = buildMetrics({
    sourcePages,
    sourceTableCount,
    sourceTableNumbers,
    sourceChartNumbers,
    sourceEquationNumbers,
    sourceReferenceCount,
    markdown,
    markdownTables,
    markdownTableNumbers,
    markdownChartNumbers,
    markdownEquationNumbers,
    equationComparisons,
    equationRenderIssues,
    markdownReferenceCount,
    missingMarkdownTables,
    missingMarkdownCharts,
    missingMarkdownEquations,
    headingIssues,
    agentReadabilityIssues,
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
    sourceChartsByPage,
    sourceChartNumbers,
    markdownChartNumbers,
    missingMarkdownCharts,
    sourceEquationsByPage,
    sourceEquationNumbers,
    markdownEquationNumbers,
    missingMarkdownEquations,
    equationComparisons,
    malformedMarkdownEquations,
    placeholderMarkdownEquations,
    lowSimilarityMarkdownEquations,
    equationRenderIssues,
    sourceReferenceCount,
    markdownReferenceCount,
    headingIssues,
    agentReadabilityIssues,
    parserImprovementSuggestions,
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
  if (tableNumbers.length === 0 && looksLikeDiagramPage(pageText)) {
    return { page, count: 0, tableNumbers };
  }
  if (tableNumbers.length === 0 && looksLikeEquationHeavyPage(pageText)) {
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

function looksLikeDiagramPage(pageText: string): boolean {
  if (!/\b(?:Figure|Fig\.?|Chart)\s+\d+\s*[:.]/i.test(pageText)) return false;

  const lines = pageText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const shortLines = lines.filter((line) => line.length <= 36).length;
  const diagramTerms = (
    pageText.match(
      /\b(?:module|frame|point cloud|feature|network|kalman|projection|conv|mlp|lstm|cnn|detection|tracking|flowchart|architecture)\b/gi
    ) ?? []
  ).length;
  const numericTokens = (pageText.match(/\b\d+(?:x\d+)+\b|\b\d+(?:\.\d+)?\b/g) ?? []).length;

  return shortLines >= 12 && diagramTerms >= 8 && numericTokens >= 6;
}

function looksLikeEquationHeavyPage(pageText: string): boolean {
  const equationLabels = equationNumbersForText(pageText).length;
  if (equationLabels === 0) return false;

  const mathSymbols = (
    pageText.match(
      /[=\u2211\u221A\u222B\u2264\u2265\u00B1\u2212\u00D7\u00F7<>]|\\(?:frac|sum|sqrt|int)|\^|_/g
    ) ?? []
  ).length;
  const matrixGlyphs = (pageText.match(/[]/g) ?? []).length;
  return mathSymbols >= 12 || matrixGlyphs >= 4;
}

function tableCaptionsForText(text: string): string[] {
  const captions: string[] = [];
  const captionRegex = new RegExp(TABLE_CAPTION_RE.source, 'gi');

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    for (const match of trimmed.matchAll(captionRegex)) {
      if (!looksLikeSourceTableCaptionLine(trimmed, match.index ?? 0)) continue;
      captions.push(match[1]);
    }
  }

  return captions;
}

function looksLikeSourceTableCaptionLine(line: string, captionIndex: number): boolean {
  if (/^(?:Table|Tab\.?)\s+\d+/i.test(line)) return true;
  if (/^\*{0,2}(?:Table|Tab\.?)\s+\d+/i.test(line)) return true;

  const caption = line.slice(captionIndex);
  const prefix = line.slice(0, captionIndex);
  return (
    captionIndex >= 24 && /\s{4,}$/.test(prefix) && /^(?:Table|Tab\.?)\s+\d+\s*[:.]/i.test(caption)
  );
}

function sourceNumberedItemsForPage(
  pageText: string,
  page: number,
  captionRegex: RegExp
): SourceNumberedPage {
  const numbers = markdownNumberedItems(pageText, captionRegex);
  return { page, count: numbers.length, numbers };
}

function markdownNumberedItems(markdown: string, captionRegex: RegExp): string[] {
  const numbers: string[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^\*+|\*+$/g, '');
    if (!looksLikeNumberedFigureCaption(trimmed)) continue;

    const match = trimmed.match(captionRegex);
    if (match) numbers.push(match[1]);
  }

  return numbers;
}

function looksLikeNumberedFigureCaption(line: string): boolean {
  if (/^(?:Figure|Fig\.?|Chart)\s+\d+/i.test(line)) return true;
  if (/^(?:\([a-z0-9^]+\)\s*){1,6}(?:Figure|Fig\.?|Chart)\s+\d+/i.test(line)) return true;

  const match = line.match(/\b(?:Figure|Fig\.?|Chart)\s+\d+/i);
  if (!match || match.index === undefined || match.index > 36) return false;

  const prefix = line.slice(0, match.index).trim();
  if (!prefix || /[.!?]$/.test(prefix)) return false;
  const prefixWords = prefix.split(/\s+/).filter(Boolean);
  return prefixWords.length <= 4;
}

function sourceEquationsForPage(pageText: string, page: number): SourceNumberedPage {
  const numbers = sourceEquationEvidenceForPage(pageText, page).map((equation) => equation.number);
  return { page, count: numbers.length, numbers };
}

function sourceEquationEvidenceForPage(pageText: string, page: number): EquationEvidence[] {
  return equationEvidenceFromLines(pageText.split(/\r?\n/), {
    page,
    githubDisplayMath: false,
  });
}

function markdownEquationEvidenceForText(markdown: string): EquationEvidence[] {
  const lines = markdown.split(/\r?\n/);
  const evidence: EquationEvidence[] = [];
  const displayMathLines = new Set<number>();
  let inDisplayMath = false;
  let blockStartLine = 0;
  let blockLines: string[] = [];

  const flushDisplayBlock = (): void => {
    const text = blockLines.join('\n').trim();
    for (const number of equationNumberMatches(text)) {
      evidence.push(
        buildEquationEvidence(number, text, {
          line: blockStartLine,
          githubDisplayMath: true,
        })
      );
    }
    blockLines = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const delimiterIndexes = mathDelimiterIndexes(line);
    if (!inDisplayMath && delimiterIndexes.length === 0) continue;

    if (!inDisplayMath) {
      inDisplayMath = true;
      blockStartLine = i + 1;
      displayMathLines.add(i);
      const contentStart = delimiterIndexes[0] + 2;
      const closing = delimiterIndexes.find((index) => index > delimiterIndexes[0]);
      if (closing !== undefined) {
        blockLines.push(line.slice(contentStart, closing));
        flushDisplayBlock();
        inDisplayMath = false;
      } else {
        blockLines.push(line.slice(contentStart));
      }
      continue;
    }

    displayMathLines.add(i);
    const closing = delimiterIndexes[0];
    if (closing !== undefined) {
      blockLines.push(line.slice(0, closing));
      flushDisplayBlock();
      inDisplayMath = false;
    } else {
      blockLines.push(line);
    }
  }

  const nonDisplayLines = lines.map((line, index) => (displayMathLines.has(index) ? '' : line));
  evidence.push(...equationEvidenceFromLines(nonDisplayLines, { githubDisplayMath: false }));
  return uniqueEquationEvidence(evidence);
}

function assessEquationRenderability(markdown: string): EquationRenderIssue[] {
  const lines = markdown.split(/\r?\n/);
  const issues: EquationRenderIssue[] = [];
  let inDisplayMath = false;
  let blockStartLine = 0;
  let blockLines: string[] = [];

  const flush = (): void => {
    issues.push(...equationRenderIssuesForBlock(blockLines, blockStartLine));
    blockLines = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === '$$') {
      if (inDisplayMath) {
        flush();
        inDisplayMath = false;
      } else {
        inDisplayMath = true;
        blockStartLine = i + 1;
        blockLines = [];
      }
      continue;
    }
    if (inDisplayMath) blockLines.push(lines[i]);
  }

  if (inDisplayMath) {
    issues.push({
      line: blockStartLine,
      message: 'display math block is missing a closing $$ delimiter',
    });
  }

  return issues.slice(0, 100);
}

function equationRenderIssuesForBlock(lines: string[], startLine: number): EquationRenderIssue[] {
  const issues: EquationRenderIssue[] = [];
  const text = lines.join('\n');
  const tag = text.match(/\\tag\{(\d{1,3})\}/)?.[1];

  const push = (offset: number, message: string): void => {
    issues.push({ line: startLine + offset, number: tag, message });
  };

  let alignedDepth = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.includes('$$')) push(i, 'nested $$ delimiter inside display math block');
    if (/\\begin\{aligned\}/.test(trimmed)) alignedDepth += 1;
    if (/\\end\{aligned\}/.test(trimmed)) alignedDepth -= 1;
    if (alignedDepth < 0) {
      push(i, 'display math has \\end{aligned} before \\begin{aligned}');
      alignedDepth = 0;
    }
    if (/(?:^|[+\-*/=(,{])\s*\^/.test(trimmed) || /\^\s*(?:\\\\|$)/.test(trimmed)) {
      push(i, 'dangling superscript marker is likely to fail math rendering');
    }
    if (/\b6\s*=|ˆ/.test(trimmed)) {
      push(i, 'OCR math artifact should be normalized before rendering');
    }
    if (/^[*+\-/]\s*\S/.test(trimmed)) {
      push(i, 'operator is split onto a separate rendered row');
    }
    if (/^\\sum(?:\s*\^\s*\S+)?\s*\\\\?$/.test(trimmed)) {
      const next = lines[i + 1]?.trim() ?? '';
      if (
        /^[A-Za-zΑ-Ωα-ω0-9\\{}_^,\s]+\s*(?:=|\\in|\\ne)/.test(next) ||
        /^[A-Za-z](?:[A-Za-z0-9,]|\s|\\hat\{[A-Za-z]\}){0,12}\s*\\\\?$/.test(next)
      ) {
        push(i, 'summation limit is split onto a separate rendered row');
      }
    }
  }

  if (alignedDepth > 0) {
    push(lines.length - 1, 'display math is missing \\end{aligned}');
  }
  if (alignedDepth < 0) {
    push(lines.length - 1, 'display math has too many \\end{aligned} markers');
  }

  return issues;
}

function mathDelimiterIndexes(line: string): number[] {
  const indexes: number[] = [];
  const regex = /\$\$/g;
  let match = regex.exec(line);
  while (match) {
    indexes.push(match.index);
    match = regex.exec(line);
  }
  return indexes;
}

function equationEvidenceFromLines(
  lines: string[],
  options: { page?: number; githubDisplayMath: boolean }
): EquationEvidence[] {
  const evidence: EquationEvidence[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const numbers = equationNumberMatches(line);
    if (numbers.length === 0) continue;

    const context = equationContextForLine(lines, i);
    if (!looksLikeEquation(context)) continue;

    for (const number of numbers) {
      evidence.push(
        buildEquationEvidence(number, context, {
          page: options.page,
          line: i + 1,
          githubDisplayMath: options.githubDisplayMath,
        })
      );
    }
  }

  return uniqueEquationEvidence(evidence);
}

function buildEquationEvidence(
  number: string,
  text: string,
  options: { page?: number; line?: number; githubDisplayMath: boolean }
): EquationEvidence {
  const equationText = isolateEquationText(number, text);
  return {
    number,
    text: equationText,
    normalizedText: normalizeEquationText(equationText),
    placeholder: /Equation not extracted|Source equation not extracted|see PDF page/i.test(
      equationText
    ),
    githubDisplayMath: options.githubDisplayMath,
    page: options.page,
    line: options.line,
  };
}

function isolateEquationText(number: string, text: string): string {
  const trimmed = text.trim();
  if (trimmed.includes(`\\tag{${number}}`)) return trimmed;

  const labelMatch = equationLabelMatchForNumber(trimmed, number);
  if (!labelMatch) return trimmed;

  const beforeLabel = trimmed.slice(0, labelMatch.index).trimEnd();
  const equationStart = equationStartIndex(beforeLabel);
  const equationBody = equationStart >= 0 ? beforeLabel.slice(equationStart).trim() : beforeLabel;
  return `${equationBody} (${number})`.trim();
}

function equationLabelMatchForNumber(
  text: string,
  number: string
): { index: number; label: string } | undefined {
  const labelRegex = new RegExp(`\\(${escapeRegExp(number)}\\)`, 'g');
  let match = labelRegex.exec(text);
  while (match) {
    const before = text.slice(0, match.index);
    const after = text.slice(match.index + match[0].length);
    if (looksLikeEquation(before) && (!after.trim() || looksLikeEquationLabelSuffix(after))) {
      return { index: match.index, label: match[0] };
    }
    match = labelRegex.exec(text);
  }
  return undefined;
}

function looksLikeEquationLabelSuffix(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/^(?:where\b|[,.;])/i.test(trimmed)) return true;
  const nextLabel = trimmed.match(/^(?:[,.;]\s*)?\(?\d{1,3}\)?/);
  if (nextLabel) return true;
  const equationStart = equationStartIndex(trimmed);
  return equationStart >= 0 && equationStart <= 80;
}

function equationStartIndex(text: string): number {
  const equalsMatches = Array.from(text.matchAll(/=/g));
  for (let i = equalsMatches.length - 1; i >= 0; i -= 1) {
    const equalsIndex = equalsMatches[i].index!;
    const beforeEquals = text.slice(0, equalsIndex);
    const lhs = beforeEquals.match(
      /[A-Za-zΑ-Ωα-ω][A-Za-z0-9Α-Ωα-ω^_{}(),|]*(?:\s+[A-Za-zΑ-Ωα-ω][A-Za-z0-9Α-Ωα-ω^_{}(),|]*)?\s*$/
    );
    if (!lhs) continue;
    const index = beforeEquals.length - lhs[0].length;
    const suffix = text.slice(index);
    if (equationSignalCount(suffix) > 0) return index;
  }

  const mathTokenMatches = Array.from(
    text.matchAll(/[A-Za-zΑ-Ωα-ω0-9|{}()[\]^_+\-*/=<>]+/g)
  ).filter((match) => equationSignalCount(text.slice(match.index!)) > 0);
  if (mathTokenMatches.length === 0) return -1;
  return Math.max(0, mathTokenMatches[mathTokenMatches.length - 1].index! - 20);
}

function uniqueEquationEvidence(evidence: EquationEvidence[]): EquationEvidence[] {
  const byNumber = new Map<string, EquationEvidence>();
  for (const item of evidence) {
    const previous = byNumber.get(item.number);
    if (!previous || equationEvidenceRank(item) > equationEvidenceRank(previous)) {
      byNumber.set(item.number, item);
    }
  }
  return Array.from(byNumber.values());
}

function equationEvidenceRank(evidence: EquationEvidence): number {
  return (
    (evidence.githubDisplayMath ? 4 : 0) +
    (evidence.placeholder ? 0 : 2) +
    Math.min(2, equationTokens(evidence.normalizedText).length / 8)
  );
}

function compareEquations(
  sourceEvidence: EquationEvidence[],
  markdownEvidence: EquationEvidence[]
): EquationComparison[] {
  const markdownByNumber = new Map(markdownEvidence.map((equation) => [equation.number, equation]));

  return uniqueEquationEvidence(sourceEvidence).map((source) => {
    const markdown = markdownByNumber.get(source.number);
    if (!markdown) {
      return {
        number: source.number,
        presentInMarkdown: false,
        githubDisplayMath: false,
        placeholderOnly: false,
        contentSimilarity: 0,
        status: 'missing',
        sourcePage: source.page,
        sourceText: source.text,
      };
    }

    let contentSimilarity = 0;
    if (!markdown.placeholder) {
      contentSimilarity = comparableEquationBody(source.normalizedText, markdown.normalizedText)
        ? equationSimilarity(source.normalizedText, markdown.normalizedText)
        : 1;
    }
    let status: EquationComparison['status'] = 'matched';
    if (markdown.placeholder) {
      status = 'placeholder';
    } else if (!markdown.githubDisplayMath) {
      status = 'format-issue';
    } else if (contentSimilarity < 0.25) {
      status = 'content-mismatch';
    }

    return {
      number: source.number,
      presentInMarkdown: true,
      githubDisplayMath: markdown.githubDisplayMath,
      placeholderOnly: markdown.placeholder,
      contentSimilarity: round(contentSimilarity),
      status,
      sourcePage: source.page,
      sourceText: source.text,
      markdownText: markdown.text,
    };
  });
}

function comparisonNumbers(
  comparisons: EquationComparison[],
  status: EquationComparison['status']
): string[] {
  return comparisons
    .filter((comparison) => comparison.status === status)
    .map((comparison) => comparison.number);
}

function normalizeEquationText(text: string): string {
  return text
    .replace(/\\tag\{\d{1,3}\}/g, ' ')
    .replace(/\\(?:begin|end)\{[^}]+\}/g, ' ')
    .replace(/(?:^|[\s,.;])\(\d{1,3}\)(?=(?:\s*where\b.*)?\s*$|\s+[A-Za-z]+\s*=)/gi, ' ')
    .replace(EQUATION_NUMBER_RE, ' ')
    .replace(/\\text\{[^}]*Equation not extracted[^}]*\}/gi, ' ')
    .replace(/Equation not extracted[^.\n]*/gi, ' ')
    .replace(/\bPDF page \d+\b/gi, ' ')
    .replace(/[∆Δ]/g, ' delta ')
    .replace(/[Σ∑]/g, ' sum ')
    .replace(/[√]/g, ' sqrt ')
    .replace(/[−]/g, '-')
    .replace(/[×]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/\\times\b/g, ' * ')
    .replace(/\\cdot\b/g, ' * ')
    .replace(/\\le\b/g, ' <= ')
    .replace(/\\ge\b/g, ' >= ')
    .replace(/\b([A-Z])\s+([A-Z]{1,3})\b/g, '$1$2')
    .replace(/\\(?:frac|sum|sqrt|int|left|right|mathrm|operatorname|mathbf|mathit|text)\b/g, ' ')
    .replace(/[{}()[\],.;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function equationSimilarity(sourceText: string, markdownText: string): number {
  const sourceTokens = equationTokens(sourceText);
  const markdownTokens = equationTokens(markdownText);
  if (sourceTokens.length < 2 || markdownTokens.length < 2) return 1;

  const markdownCounts = new Map<string, number>();
  for (const token of markdownTokens) {
    markdownCounts.set(token, (markdownCounts.get(token) ?? 0) + 1);
  }

  let overlap = 0;
  for (const token of sourceTokens) {
    const count = markdownCounts.get(token) ?? 0;
    if (count === 0) continue;
    overlap += 1;
    markdownCounts.set(token, count - 1);
  }

  const dice = (2 * overlap) / (sourceTokens.length + markdownTokens.length);
  const sourceRecall = overlap / sourceTokens.length;
  return Math.max(dice, sourceRecall);
}

function comparableEquationBody(sourceText: string, markdownText: string): boolean {
  const sourceTokens = equationTokens(sourceText);
  const markdownTokens = equationTokens(markdownText);
  if (sourceTokens.length <= 3 && sourceTokens.includes('=') && markdownTokens.length >= 2) {
    return false;
  }
  return true;
}

function equationTokens(text: string): string[] {
  return text.match(/[a-z0-9]+|[=+\-*/^_<>|]/g) ?? [];
}

function equationNumbersForText(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const numbers: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const taggedMatches = Array.from(lines[i].matchAll(/\\tag\{(\d{1,3})\}/g), (match) => match[1]);
    if (taggedMatches.length > 0) {
      numbers.push(...taggedMatches);
      continue;
    }

    const context = equationContextForLine(lines, i);
    if (!looksLikeEquation(context)) continue;

    for (const match of equationNumberMatches(lines[i])) {
      numbers.push(match);
    }
  }

  return numbers;
}

function equationNumberMatches(line: string): string[] {
  const taggedMatches = Array.from(line.matchAll(/\\tag\{(\d{1,3})\}/g), (match) => match[1]);
  if (taggedMatches.length > 0) return taggedMatches;

  const matches = Array.from(
    line.matchAll(/(?:^|[\s,.;])\((\d{1,3})\)(?=(?:\s*where\b.*)?\s*$|\s+[A-Za-z]+\s*=)/gi),
    (match) => match[1]
  );
  if (matches.length > 0) return matches;

  const endMatch = line.match(EQUATION_NUMBER_RE);
  return endMatch ? [endMatch[1]] : [];
}

function equationContextForLine(lines: string[], labelIndex: number): string {
  const context: string[] = [lines[labelIndex]];

  for (let i = labelIndex - 1; i >= 0 && context.length < 12; i -= 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (looksLikeEquationContextBoundary(trimmed)) break;
    context.unshift(trimmed);
    if (context.length >= 3 && equationSignalCount(context.join(' ')) >= 2) break;
  }

  return context.join(' ');
}

function looksLikeEquationContextBoundary(line: string): boolean {
  if (/^#{1,6}\s+\S/.test(line)) return true;
  const words = line.split(/\s+/).filter(Boolean);
  const mathSymbols = (
    line.match(/[=\u2211\u221A\u222B\u2264\u2265\u00B1\u2212\u00D7\u00F7<>|]|\^|_/g) ?? []
  ).length;
  return words.length >= 10 && mathSymbols === 0 && /[.!?]$/.test(line);
}

function looksLikeEquation(text: string): boolean {
  const mathSymbols = equationSignalCount(text);
  const naturalLanguageWords = (text.match(/[A-Za-z]{3,}/g) ?? []).length;
  return (
    mathSymbols >= 1 &&
    (naturalLanguageWords <= 12 || (mathSymbols >= 3 && naturalLanguageWords <= 32))
  );
}

function equationSignalCount(text: string): number {
  return (
    text.match(
      /[=\u2211\u221A\u222B\u2264\u2265\u00B1\u2212\u00D7\u00F7<>|]|\\(?:frac|sum|sqrt|int)|\^|_/g
    ) ?? []
  ).length;
}

function countReferences(text: string): number {
  const references = referenceSection(text);
  if (!references) return 0;

  const bracketed = references.match(/\[\d{1,3}\]/g) ?? [];
  if (bracketed.length > 0) return new Set(bracketed).size;

  const numberedLines = references
    .split(/\r?\n/)
    .filter((line) => /^\s*\d{1,3}\.\s+\S/.test(line)).length;
  return numberedLines;
}

function referenceSection(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((line) => /^\s*#{0,6}\s*References\b/i.test(line.trim()));
  if (index < 0) return undefined;

  const body: string[] = [];
  let sawReferenceEntry = false;
  for (const line of lines.slice(index + 1)) {
    const trimmed = line.trim();
    if (isReferenceEntryLine(trimmed)) sawReferenceEntry = true;
    if (sawReferenceEntry && isPostReferenceMarker(trimmed)) break;
    body.push(line);
  }
  return body.join('\n');
}

function isReferenceEntryLine(line: string): boolean {
  return /^(?:\[\d{1,3}\]|\d{1,3}\.\s+\S)/.test(line);
}

function isPostReferenceMarker(line: string): boolean {
  return (
    /^#{1,6}\s+\S/.test(line) ||
    /^(?:Figure|Fig\.?|Table|Tab\.?)\s+(?:\d+|[IVXLCDM]+)(?:\.\s+Source\b|\s*[:.]\s+)/i.test(
      line
    ) ||
    /^>\s*Figure source:/i.test(line)
  );
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
  if (looksLikeChartAxisBlock(rows)) return false;

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

function looksLikeChartAxisBlock(rows: string[][]): boolean {
  const text = rows.flat().join(' ');
  const axisTerms = (
    text.match(
      /\b(?:accuracy|precision|recall|ratio|noise|std|threshold|epoch|iteration|time|frequency)\b/gi
    ) ?? []
  ).length;
  const chartSeriesTerms = (
    text.match(/\b(?:random|furthest|xyz|density|baseline|method|model)\b/gi) ?? []
  ).length;
  const decimalTokens = (text.match(/\b\d+\.\d+\b/g) ?? []).length;
  const tableTerms = (text.match(/\b(?:Table|Tab\.?|FLOPs?|params?|dataset)\b/gi) ?? []).length;

  return axisTerms >= 3 && decimalTokens >= 4 && chartSeriesTerms >= 1 && tableTerms === 0;
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
    if (isInsideMarkdownTable(lines, i)) {
      tableNumbers.push(match[1]);
      continue;
    }
    if (previous !== undefined && isInsideMarkdownTable(lines, previous)) {
      tableNumbers.push(match[1]);
      continue;
    }

    if (previous !== undefined && hasNearbyMarkdownTableAbove(lines, previous)) {
      tableNumbers.push(match[1]);
      continue;
    }

    if (previous !== undefined && hasNearbyTableEvidenceAbove(lines, previous)) {
      tableNumbers.push(match[1]);
      continue;
    }

    if (hasNearbyMarkdownTableBelow(lines, i)) {
      tableNumbers.push(match[1]);
      continue;
    }

    if (hasNearbyTableEvidenceBelow(lines, i)) {
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

function hasNearbyMarkdownTableAbove(lines: string[], fromIndex: number): boolean {
  let checked = 0;
  for (let i = fromIndex; i >= 0 && checked < 4; i -= 1) {
    if (!lines[i].trim()) continue;
    checked += 1;
    if (isInsideMarkdownTable(lines, i)) return true;
    if (/^(?:#{1,6}\s|(?:Table|Tab\.?|Figure|Fig\.?)\s+\d+(?:\s*[:.]|\b))/i.test(lines[i].trim())) {
      return false;
    }
  }
  return false;
}

function hasNearbyTableEvidenceAbove(lines: string[], fromIndex: number): boolean {
  let checked = 0;
  let evidenceLines = 0;
  for (let i = fromIndex; i >= 0 && checked < 10; i -= 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    checked += 1;
    if (/^(?:#{1,6}\s|(?:Table|Tab\.?|Figure|Fig\.?)\s+\d+(?:\s*[:.]|\b))/i.test(trimmed)) {
      break;
    }
    if (looksLikeMarkdownTableEvidence(trimmed)) evidenceLines += 1;
  }
  return evidenceLines >= 2;
}

function hasNearbyMarkdownTableBelow(lines: string[], fromIndex: number): boolean {
  let checked = 0;
  for (let i = fromIndex + 1; i < lines.length && checked < 6; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    checked += 1;
    if (i + 1 < lines.length && isPipeRow(lines[i]) && isSeparatorRow(lines[i + 1])) {
      return true;
    }
    if (/^(?:#{1,6}\s|(?:Table|Tab\.?|Figure|Fig\.?)\s+\d+(?:\s*[:.]|\b))/i.test(trimmed)) {
      return false;
    }
  }
  return false;
}

function hasNearbyTableEvidenceBelow(lines: string[], fromIndex: number): boolean {
  let checked = 0;
  let evidenceLines = 0;
  for (let i = fromIndex + 1; i < lines.length && checked < 10; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    checked += 1;
    if (/^(?:#{1,6}\s|(?:Table|Tab\.?|Figure|Fig\.?)\s+\d+(?:\s*[:.]|\b))/i.test(trimmed)) {
      break;
    }
    if (looksLikeMarkdownTableEvidence(trimmed)) evidenceLines += 1;
  }
  return evidenceLines >= 1;
}

function looksLikeMarkdownTableEvidence(line: string): boolean {
  const pipeCount = (line.match(/\|/g) ?? []).length;
  const numericTokens = (line.match(/\d+(?:\.\d+)?/g) ?? []).length;
  const tokens = line.split(/\s+/).filter(Boolean);
  return (
    (pipeCount >= 3 && numericTokens >= 2) ||
    (numericTokens >= 8 && tokens.length >= 12 && !/[.!?]$/.test(line))
  );
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
    if (
      block.length >= 4 &&
      block.every((heading) => heading.level === 3) &&
      !block.every((heading) => isNumberedHeading(heading.text))
    ) {
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

function isNumberedHeading(text: string): boolean {
  return /^\d+(?:\.\d+)+\.?\s+\S/.test(text);
}

function assessAgentReadability(markdown: string): AgentReadabilityIssue[] {
  const lines = markdown.split(/\r?\n/);
  const issues: AgentReadabilityIssue[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || isPipeRow(trimmed)) continue;

    const numericTokens = (trimmed.match(/\d+(?:\.\d+)?/g) ?? []).length;
    if (trimmed.length > 260) {
      issues.push({
        line: i + 1,
        severity: 'high',
        message: 'very long line is hard for an agent to scan and quote precisely',
        suggestion:
          'preserve paragraph wrapping or split extracted multi-column/table text into blocks',
      });
    } else if (trimmed.length > 180 && numericTokens >= 8) {
      issues.push({
        line: i + 1,
        severity: 'medium',
        message: 'dense numeric line may be a collapsed table or chart label block',
        suggestion: 'recover a Markdown table or fenced layout block from PDF layout coordinates',
      });
    }

    if (/\b(?:Table|Tab\.?|Figure|Fig\.?|Chart)\s+\d+[:.]/i.test(trimmed) && trimmed.length > 180) {
      issues.push({
        line: i + 1,
        severity: 'high',
        message: 'caption appears merged with surrounding data or prose',
        suggestion: 'split captions onto their own line and attach preceding table/figure evidence',
      });
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      const words = text.split(/\s+/).filter(Boolean);
      if (level >= 4 && (words.length >= 5 || /^[a-z]/.test(text))) {
        issues.push({
          line: i + 1,
          severity: 'medium',
          message: 'wrapped body text was emitted as a deep heading',
          suggestion: 'demote prose-like h4-h6 lines unless they match a section-number pattern',
        });
      }
      if (/[\u2211\u221A\u222B=|{}]|\(\d+\)/.test(text) && words.length <= 4) {
        issues.push({
          line: i + 1,
          severity: 'medium',
          message: 'equation fragment was emitted as a heading',
          suggestion:
            'emit equations as GitHub-compatible display math blocks with labels preserved',
        });
      }
    }
  }

  const referenceIssues = assessReferenceReadability(markdown);
  issues.push(...referenceIssues);

  return issues.slice(0, 50);
}

function assessReferenceReadability(markdown: string): AgentReadabilityIssue[] {
  const references = referenceSection(markdown);
  if (!references) return [];

  const lines = references.split(/\r?\n/).filter((line) => line.trim());
  const referenceCount = countReferences(markdown);
  const veryLongReferenceLines = lines.filter((line) => line.length > 240).length;
  if (referenceCount >= 5 && veryLongReferenceLines >= Math.ceil(referenceCount / 4)) {
    return [
      {
        severity: 'medium',
        message: 'references section has many overlong lines',
        suggestion: 'split references into one entry per paragraph or list item during extraction',
      },
    ];
  }
  return [];
}

function scoreAgentReadability(issues: AgentReadabilityIssue[]): number {
  const penalty = issues.reduce((sum, issue) => {
    if (issue.severity === 'high') return sum + 0.15;
    if (issue.severity === 'medium') return sum + 0.08;
    return sum + 0.03;
  }, 0);
  return clamp(1 - penalty);
}

function parserSuggestions(args: {
  missingMarkdownTables: string[];
  missingMarkdownCharts: string[];
  missingMarkdownEquations: string[];
  malformedMarkdownEquations: string[];
  placeholderMarkdownEquations: string[];
  lowSimilarityMarkdownEquations: string[];
  equationRenderIssues: EquationRenderIssue[];
  sourceReferenceCount: number;
  markdownReferenceCount: number;
  agentReadabilityIssues: AgentReadabilityIssue[];
  headingIssues: HeadingIssue[];
}): string[] {
  const suggestions = new Set<string>();

  if (args.missingMarkdownTables.length > 0) {
    suggestions.add('Improve table recovery from layout text and same-line captions.');
  }
  if (args.missingMarkdownCharts.length > 0) {
    suggestions.add(
      'Preserve figure/chart captions and emit image placeholders with page anchors.'
    );
  }
  if (args.missingMarkdownEquations.length > 0) {
    suggestions.add(
      'Detect equation blocks and preserve numbered equations as GitHub-compatible display math blocks.'
    );
  }
  if (args.malformedMarkdownEquations.length > 0) {
    suggestions.add('Emit numbered equations as GitHub-compatible $$ display math blocks.');
  }
  if (args.placeholderMarkdownEquations.length > 0) {
    suggestions.add('Recover equation bodies instead of emitting equation placeholders.');
  }
  if (args.lowSimilarityMarkdownEquations.length > 0) {
    suggestions.add('Improve equation body reconstruction from PDF layout text.');
  }
  if (args.equationRenderIssues.length > 0) {
    suggestions.add('Normalize LaTeX equation syntax so generated display math renders cleanly.');
  }
  if (args.sourceReferenceCount > 0 && args.markdownReferenceCount < args.sourceReferenceCount) {
    suggestions.add(
      'Parse references into one entry per paragraph/list item after the References heading.'
    );
  }
  if (args.headingIssues.length > 0) {
    suggestions.add(
      'Demote metadata, formulas, and wrapped prose that are incorrectly emitted as headings.'
    );
  }
  for (const issue of args.agentReadabilityIssues) {
    suggestions.add(issue.suggestion);
  }

  return Array.from(suggestions);
}

function buildMetrics(args: {
  sourcePages: string[];
  sourceTableCount: number;
  sourceTableNumbers: string[];
  sourceChartNumbers: string[];
  sourceEquationNumbers: string[];
  sourceReferenceCount: number;
  markdown?: string;
  markdownTables: MarkdownTable[];
  markdownTableNumbers: string[];
  markdownChartNumbers: string[];
  markdownEquationNumbers: string[];
  equationComparisons: EquationComparison[];
  equationRenderIssues: EquationRenderIssue[];
  markdownReferenceCount: number;
  missingMarkdownTables: string[];
  missingMarkdownCharts: string[];
  missingMarkdownEquations: string[];
  headingIssues: HeadingIssue[];
  agentReadabilityIssues: AgentReadabilityIssue[];
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
  const sourceChartCount = args.sourceChartNumbers.length;
  const markdownChartCount = args.markdownChartNumbers.length;
  const sourceEquationCount = args.sourceEquationNumbers.length;
  const markdownEquationCount = args.markdownEquationNumbers.length;
  const formattedEquationCount = args.equationComparisons.filter(
    (comparison) => comparison.githubDisplayMath
  ).length;
  const equationFormatScore =
    sourceEquationCount === 0 ? 1 : formattedEquationCount / sourceEquationCount;
  const equationContentScore =
    sourceEquationCount === 0
      ? 1
      : args.equationComparisons.reduce(
          (sum, comparison) => sum + comparison.contentSimilarity,
          0
        ) / sourceEquationCount;
  const equationRenderScore =
    markdownEquationCount === 0
      ? 1
      : clamp(1 - args.equationRenderIssues.length / markdownEquationCount);
  const { sourceReferenceCount, markdownReferenceCount } = args;
  const headingFlowScore = scoreHeadings(markdown).score;
  const artifactScore = scoreArtifacts(markdown);
  const agentReadabilityScore = scoreAgentReadability(args.agentReadabilityIssues);

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
      sourceChartCount,
      markdownChartCount,
      chartCoverageScore: 0,
      sourceEquationCount,
      markdownEquationCount,
      equationCoverageScore: 0,
      equationFormatScore: 0,
      equationContentScore: 0,
      equationRenderScore: 0,
      sourceReferenceCount,
      markdownReferenceCount,
      referenceCoverageScore: 0,
      headingFlowScore: 0,
      arxivPlacementScore: 0,
      completenessScore: 0,
      artifactScore: 0,
      agentReadabilityScore: 0,
      sourceWordCount,
      markdownWordCount,
    };
  }

  if (sourcePages === 0) {
    return {
      score: round(
        100 *
          (0.1 * tableFormattingScore +
            0.14 * headingFlowScore +
            0.05 * artifactScore +
            0.05 * agentReadabilityScore)
      ),
      sourcePages,
      markdownPages,
      pageBreakScore: 0,
      sourceTableCount,
      markdownTableCount,
      tableCoverageScore: 0,
      tableFormattingScore: round(tableFormattingScore),
      sourceChartCount,
      markdownChartCount,
      chartCoverageScore: 0,
      sourceEquationCount,
      markdownEquationCount,
      equationCoverageScore: 0,
      equationFormatScore: sourceEquationCount === 0 ? 0 : round(equationFormatScore),
      equationContentScore: sourceEquationCount === 0 ? 0 : round(equationContentScore),
      equationRenderScore: markdownEquationCount === 0 ? 0 : round(equationRenderScore),
      sourceReferenceCount,
      markdownReferenceCount,
      referenceCoverageScore: 0,
      headingFlowScore: round(headingFlowScore),
      arxivPlacementScore: 0,
      completenessScore: 0,
      artifactScore: round(artifactScore),
      agentReadabilityScore: round(agentReadabilityScore),
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
  const chartCoverageScore = coverageFromMissing(
    sourceChartCount,
    args.missingMarkdownCharts.length
  );
  const equationCoverageScore = coverageFromMissing(
    sourceEquationCount,
    args.missingMarkdownEquations.length
  );
  const referenceCoverageScore =
    sourceReferenceCount === 0 ? 1 : clamp(markdownReferenceCount / sourceReferenceCount);
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
      (0.18 * tableCoverageScore +
        0.1 * tableFormattingScore +
        0.1 * chartCoverageScore +
        0.04 * equationCoverageScore +
        0.02 * equationFormatScore +
        0.015 * equationContentScore +
        0.005 * equationRenderScore +
        0.08 * referenceCoverageScore +
        0.14 * headingFlowScore +
        0.08 * arxivPlacementScore +
        0.07 * pageBreakScore +
        0.07 * completenessScore +
        0.05 * artifactScore +
        0.05 * agentReadabilityScore)
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
    sourceChartCount,
    markdownChartCount,
    chartCoverageScore: round(chartCoverageScore),
    sourceEquationCount,
    markdownEquationCount,
    equationCoverageScore: round(equationCoverageScore),
    equationFormatScore: round(equationFormatScore),
    equationContentScore: round(equationContentScore),
    equationRenderScore: round(equationRenderScore),
    sourceReferenceCount,
    markdownReferenceCount,
    referenceCoverageScore: round(referenceCoverageScore),
    headingFlowScore: round(headingFlowScore),
    arxivPlacementScore: round(arxivPlacementScore),
    completenessScore: round(completenessScore),
    artifactScore: round(artifactScore),
    agentReadabilityScore: round(agentReadabilityScore),
    sourceWordCount,
    markdownWordCount,
  };
}

function coverageFromMissing(sourceCount: number, missingCount: number): number {
  return sourceCount === 0 ? 1 : clamp(1 - missingCount / sourceCount);
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

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
