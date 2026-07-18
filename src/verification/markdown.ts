import fs from 'fs';
import path from 'path';
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
  // Strip running headers before any structural repair: they land mid-sentence
  // at page boundaries, so removing them first lets the split prose rejoin.
  const extracted = stripRunningHeaders(
    normalizeExtractionArtifacts((await defaultExtractor.extract(pdfPath)).trim()),
    layoutText
  );
  const firstPass = await formatGeneratedMarkdown(
    removeDuplicateMarkdownTables(
      repairLooseLineSpacing(
        addFigureSourceLinks(
          addMissingSourcePlaceholders(
            normalizeReferenceList(
              repairEquationBlocks(
                repairCaptionBoundaries(
                  repairMarkdownHeadings(
                    repairMarkdownTablesWithLayout(repairMarkdownTables(extracted), layoutText)
                  )
                )
              )
            ),
            layoutText,
            pdfPath
          ),
          layoutText,
          pdfPath
        )
      )
    )
  );
  // Strip glyph garble now, not on the raw extraction: only after prettier's
  // proseWrap isolates the substitution-font diagram labels onto their own lines
  // does the per-line majority test see them; before that they ride on long
  // lines mixed with real prose. The final format pass then collapses the gaps.
  const finalPass = await formatGeneratedMarkdown(
    removeDuplicateMarkdownTables(
      repairEquationBlocks(
        repairLooseLineSpacing(
          repairMarkdownTablesWithLayout(stripGlyphGarbleLines(firstPass), layoutText)
        )
      )
    )
  );
  const markdown = removeDuplicateMarkdownTables(
    normalizeDisplayMathBlocks(repairNestedDisplayMathBlocks(finalPass))
  );
  logger.debug('Extracted PDF markdown', { pdfPath, chars: markdown.length });
  return markdown;
}

/**
 * Remove the running header/footer that repeats at every page boundary (e.g.
 * "10  M. Liang et al." / "Learning Lane Graph Representations … 9"), which
 * pdf2md splices into the body mid-sentence.
 *
 * Detection is by repetition, not guesswork: a page's first and last lines are
 * normalized (page number stripped) and only text recurring on three or more
 * pages counts. Removal additionally requires an adjacent page number, so the
 * paper's own title — which appears once, without one — is never touched.
 */
export function stripRunningHeaders(markdown: string, layoutText?: string): string {
  if (!layoutText) return markdown;
  const headers = runningHeadersForLayout(layoutText);
  if (headers.length === 0) return markdown;

  const patterns = headers.map((header) => {
    const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(?:\\d{1,4}\\s+${escaped}|${escaped}\\s+\\d{1,4})`, 'g');
  });

  const kept: string[] = [];
  let inFence = false;
  let inMath = false;

  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      kept.push(line);
      continue;
    }
    if (line.trim() === '$$') {
      inMath = !inMath;
      kept.push(line);
      continue;
    }
    // Leave structure alone: fenced code, math, headings, and table rows.
    if (inFence || inMath || /^\s*(?:#{1,6}\s|\|)/.test(line)) {
      kept.push(line);
      continue;
    }

    let stripped = line;
    for (const pattern of patterns) stripped = stripped.replace(pattern, ' ');
    if (stripped === line) {
      kept.push(line);
      continue;
    }

    stripped = stripped.replace(/[ \t]{2,}/g, ' ').trim();
    // A line that was only the running header disappears entirely.
    if (stripped) kept.push(stripped);
  }

  return kept.join('\n');
}

function runningHeadersForLayout(layoutText: string): string[] {
  const counts = new Map<string, number>();
  for (const page of layoutText.split('\f')) {
    const lines = page
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;
    for (const candidate of new Set([lines[0], lines[lines.length - 1]])) {
      const normalized = normalizeRunningHeader(candidate);
      if (normalized) counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .filter(([, count]) => count >= 3)
    .map(([header]) => header);
}

function normalizeRunningHeader(line: string): string | undefined {
  const stripped = line
    .replace(/^\d{1,4}\s+/, '')
    .replace(/\s+\d{1,4}$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length < 8 || stripped.length > 120) return undefined;
  if (!/[A-Za-z]{3,}/.test(stripped)) return undefined;
  return stripped;
}

/**
 * Drop lines that are dominated by shifted-font glyph garble — the undecodable
 * runs pdf2md emits for figure/diagram labels drawn in a subset font (e.g.
 * `$FWRU1HW 0DS1HW` for "ActorNet MapNet"). These have a font-specific
 * substitution with no ToUnicode map, so they can't be recovered here; the real
 * labels are the vision pipeline's job (see docs/plans/visual-extraction.md).
 * Deliberately strict — three-plus garble tokens forming the majority of a line
 * — so acronyms (`CNN`, `BEV`), module names (`L2A`), and short math fragments
 * survive. Never touches fenced code or `$$` math.
 */
export function stripGlyphGarbleLines(markdown: string): string {
  const kept: string[] = [];
  let inFence = false;
  let inMath = false;

  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      kept.push(line);
      continue;
    }
    if (line.trim() === '$$') {
      inMath = !inMath;
      kept.push(line);
      continue;
    }
    if (!inFence && !inMath && isGlyphGarbleLine(line)) continue;
    kept.push(line);
  }

  return kept.join('\n');
}

function isGlyphGarbleLine(line: string): boolean {
  const tokens = line
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 2);
  if (tokens.length < 3) return false;
  const garble = tokens.filter(isGlyphGarbleToken).length;
  return garble >= 3 && garble * 2 >= tokens.length;
}

function isGlyphGarbleToken(token: string): boolean {
  if (/[a-z]/.test(token)) return false; // real words carry lowercase letters
  if (!/[A-Z]/.test(token)) return false; // must contain a letter, not pure punctuation
  if (/[$%'/*+&^]/.test(token)) return true; // symbols the substitution font produces
  return token.length >= 5 && /\d/.test(token); // long uppercase+digit gibberish
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
  let seenTitle = false;

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
        (seenTitle &&
          !seenAbstract &&
          level >= 2 &&
          !isAbstractHeading &&
          !isNumberedSection(normalizedText))
      ) {
        return normalizedText;
      }

      const normalizedLevel = normalizedHeadingLevel(level, normalizedText);
      if (!seenTitle && !seenAbstract) seenTitle = true;
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

export function normalizeReferenceList(markdown: string): string {
  const lines = markdown.split('\n');
  const headingIndex = lines.findIndex((line) => looksLikeReferenceHeading(line.trim()));
  if (headingIndex < 0) return markdown;

  const before = lines.slice(0, headingIndex);
  const headingLine = lines[headingIndex].trim();
  const headingRemainder = headingLine.replace(referenceHeadingPrefixRe(), '').trim();
  const referenceText = [headingRemainder, ...lines.slice(headingIndex + 1)]
    .filter((line, index) => index > 0 || line.length > 0)
    .join('\n')
    .trim();
  if (!referenceText) return [...before, '## References'].join('\n');

  const entries = splitReferenceEntries(referenceText);
  if (entries.length < 1) return markdown;

  return [...before, '## References', '', ...entries].join('\n');
}

export function repairEquationBlocks(markdown: string): string {
  const lines = markdown.split('\n');
  const repaired: string[] = [];
  let inFence = false;
  let inMath = false;
  let inReferences = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      repaired.push(line);
      continue;
    }
    if (trimmed === '$$') {
      inMath = !inMath;
      repaired.push(line);
      continue;
    }
    if (looksLikeReferenceHeading(trimmed)) inReferences = true;

    const inlineEquation = splitInlineLabeledEquation(trimmed);
    if (!inFence && !inMath && !inReferences && inlineEquation) {
      repaired.push(...inlineEquation);
      continue;
    }

    if (
      inFence ||
      inMath ||
      inReferences ||
      !equationLabelRe().test(trimmed) ||
      (!looksLikeEquationLine(trimmed) && equationBlockStart(lines, i) === i)
    ) {
      repaired.push(line);
      continue;
    }

    const blockStart = equationBlockStart(lines, i);
    if (blockStart < i) {
      for (let count = 0; count < i - blockStart && repaired.length > 0; count += 1) {
        repaired.pop();
      }
      const block = lines.slice(blockStart, i + 1).filter((blockLine) => blockLine.trim());
      repaired.push(...equationLinesToMathBlock(block));
      continue;
    }

    repaired.push(...equationLinesToMathBlock([trimmed]));
  }

  return compactExcessBlankLines(repaired).join('\n');
}

export function addFigureSourceLinks(
  markdown: string,
  layoutText?: string,
  pdfPath?: string
): string {
  if (!layoutText || !pdfPath) return markdown;
  const figurePages = figurePagesForLayout(layoutText);
  if (figurePages.size === 0) return markdown;

  const pdfLink = `../pdf/${encodeURI(path.basename(pdfPath))}`;
  const lines = markdown.split('\n');
  const repaired: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    repaired.push(lines[i]);
    const caption = figureCaptionForLine(lines[i]);
    if (!caption || !isFigureCaptionLine(lines[i])) continue;

    const next = nextNonEmptyLine(lines, i + 1);
    if (/^>\s*Figure source:/i.test(next)) continue;

    const page = figurePages.get(caption);
    if (!page) continue;
    repaired.push('', `> Figure source: [PDF page ${page}](${pdfLink}#page=${page})`);
  }

  return repaired.join('\n');
}

export function addMissingSourcePlaceholders(
  markdown: string,
  layoutText?: string,
  pdfPath?: string
): string {
  if (!layoutText || !pdfPath) return markdown;

  const pdfLink = `../pdf/${encodeURI(path.basename(pdfPath))}`;
  let sections = markdown.split(/(<!--\s*PAGE_BREAK\s*-->)/i);
  const markdownFigures = figuresInMarkdown(markdown);
  const markdownEquations = equationsInMarkdown(markdown);
  const layoutEquations = equationsForLayout(layoutText);

  for (const [figure, { page, caption }] of figureCaptionsForLayout(layoutText)) {
    if (markdownFigures.has(figure)) continue;
    const captionLine = caption || `Figure ${figure}.`;
    sections = appendToMarkdownPageSection(
      sections,
      page,
      `${captionLine}\n\n> Figure source: [PDF page ${page}](${pdfLink}#page=${page}) — source image not extracted`
    );
  }

  for (const [equation, page] of equationPagesForLayout(layoutText).entries()) {
    if (markdownEquations.has(equation)) continue;
    const recoveredEquation = layoutEquations.get(equation);
    sections = appendToMarkdownPageSection(
      sections,
      page,
      recoveredEquation?.markdown ??
        [
          '$$',
          `\\text{Equation not extracted; see PDF page ${page}}`,
          `\\tag{${equation}}`,
          '$$',
        ].join('\n')
    );
  }

  return sections.join('');
}

export function repairLooseLineSpacing(markdown: string): string {
  const lines = markdown.split('\n');
  const repaired: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (
      !lines[i].trim() &&
      repaired.length > 0 &&
      i + 1 < lines.length &&
      canJoinParagraphLines(repaired[repaired.length - 1], lines[i + 1])
    ) {
      continue;
    }
    repaired.push(lines[i]);
  }

  return repaired.join('\n');
}

export function removeDuplicateMarkdownTables(markdown: string): string {
  const lines = markdown.split('\n');
  const repaired: string[] = [];
  const seen = new Map<string, number>();

  for (let i = 0; i < lines.length; i += 1) {
    if (
      i + 1 >= lines.length ||
      !isMarkdownPipeRow(lines[i]) ||
      !isMarkdownSeparatorLine(lines[i + 1])
    ) {
      repaired.push(lines[i]);
      continue;
    }

    let end = i + 2;
    while (end < lines.length && isMarkdownPipeRow(lines[end])) end += 1;
    const block = lines.slice(i, end);
    const key = block.map((line) => line.replace(/\s+/g, ' ').trim()).join('\n');
    if (!seen.has(key)) {
      seen.set(key, repaired.length);
      repaired.push(...block);
    }
    i = end - 1;
  }

  return compactExcessBlankLines(repaired).join('\n').trimEnd();
}

export function normalizeDisplayMathBlocks(markdown: string): string {
  const repaired: string[] = [];
  let inMath = false;

  for (const line of markdown.split('\n')) {
    if (line.trim() === '$$') {
      repaired.push('$$');
      inMath = !inMath;
      continue;
    }

    repaired.push(inMath ? line.trim() : line);
  }

  return repaired.join('\n');
}

export function repairNestedDisplayMathBlocks(markdown: string): string {
  const lines = markdown.split('\n');
  const repaired: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (
      lines[i].trim() !== '$$' ||
      lines[i + 1]?.trim() !== '\\begin{aligned}' ||
      lines[i + 2]?.trim() !== '$$ \\\\' ||
      lines[i + 3]?.trim() !== '\\begin{aligned} \\\\'
    ) {
      repaired.push(lines[i]);
      continue;
    }

    const firstBody: string[] = [];
    let cursor = i + 4;
    while (cursor < lines.length && lines[cursor].trim() !== '$$ \\\\') {
      firstBody.push(cleanNestedMathLine(lines[cursor]));
      cursor += 1;
    }
    if (cursor >= lines.length) {
      repaired.push(lines[i]);
      continue;
    }

    const secondBody: string[] = [];
    cursor += 1;
    while (
      cursor + 2 < lines.length &&
      !(
        lines[cursor].trim() === '\\end{aligned}' &&
        /^\\tag\{\d{1,3}\}$/.test(lines[cursor + 1].trim()) &&
        lines[cursor + 2].trim() === '$$'
      )
    ) {
      secondBody.push(cleanNestedMathLine(lines[cursor]));
      cursor += 1;
    }
    if (cursor + 2 >= lines.length) {
      repaired.push(lines[i]);
      continue;
    }

    repaired.push('$$', '\\begin{aligned}', ...firstBody, '$$', '');
    repaired.push(
      '$$',
      '\\begin{aligned}',
      ...secondBody,
      '\\end{aligned}',
      lines[cursor + 1].trim(),
      '$$'
    );
    i = cursor + 2;
  }

  return repaired.join('\n');
}

function cleanNestedMathLine(line: string): string {
  const trimmed = line.trim();
  if (/\\\\\s+\\\\$/.test(trimmed)) return trimmed.replace(/\s+\\\\$/, '');
  if (/^\\(?:end\{aligned\}|tag\{\d{1,3}\})\s+\\\\$/.test(trimmed)) {
    return trimmed.replace(/\s+\\\\$/, '');
  }
  return trimmed;
}

function splitEmbeddedCaption(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [line];
  if (/^(?:Table|Tab\.?|Figure|Fig\.?|Chart)\s+\d+\s*[:.]/i.test(trimmed)) return [line];

  const match = line.match(/\b(?:Table|Tab\.?|Figure|Fig\.?|Chart)\s+\d+\s*[:.]/i);
  if (!match || match.index! < 20) return [line];

  const prefix = line.slice(0, match.index!).trimEnd();
  const caption = line.slice(match.index!).trimStart();
  if (!/[.!?)]$/.test(prefix) && prefix.length < 80) return [line];

  // A preposition before the marker means this is a cross-reference ("…the
  // cases in Fig. 5. To account…"), not a caption — leave it in the prose so it
  // is not mistaken for a real caption and does not suppress the recovered one.
  const referenceWord = prefix.match(/(\S+)$/)?.[1] ?? '';
  if (/^(?:in|on|see|from|of|to|and|via|cf\.?|figs?\.?)$/i.test(referenceWord)) return [line];

  return [prefix, '', caption];
}

function looksLikeReferenceHeading(line: string): boolean {
  return referenceHeadingPrefixRe().test(line);
}

function referenceHeadingPrefixRe(): RegExp {
  return /^(?:#{1,6}\s*)?(?:\d+\.\s*)?(?:references|REFERENCES)\b[:.]?/i;
}

function splitReferenceEntries(text: string): string[] {
  const textWithoutPageBreaks = text.replace(/<!--\s*PAGE_BREAK\s*-->/gi, '\n\n');
  const bracketedReferenceCount = Array.from(textWithoutPageBreaks.matchAll(/\[\d{1,3}\]/g)).length;
  if (bracketedReferenceCount >= 2) {
    return splitBracketedReferences(textWithoutPageBreaks);
  }

  if (/^\s*\d{1,3}\.\s+\S/m.test(textWithoutPageBreaks)) {
    return splitNumberedReferences(textWithoutPageBreaks);
  }

  if (/^\s*[-*+]\s+\S/m.test(textWithoutPageBreaks)) {
    return splitBulletReferences(textWithoutPageBreaks);
  }

  if (bracketedReferenceCount > 0) {
    return splitBracketedReferences(textWithoutPageBreaks);
  }

  return splitAuthorYearReferences(textWithoutPageBreaks);
}

function splitBulletReferences(text: string): string[] {
  const entries: string[] = [];
  let current: string[] = [];

  const flush = (): void => {
    const rawEntry = current.join(' ').replace(/\s+/g, ' ').trim();
    if (rawEntry) entries.push(rawEntry);
    current = [];
  };

  for (const line of text.split(/\r?\n/)) {
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bullet) {
      flush();
      current.push(bullet[1].trim());
      continue;
    }

    if (current.length > 0 && line.trim()) {
      current.push(line.trim());
    }
  }
  flush();

  return entries.map((entry, index) => {
    const labeled = entry.match(/^\[(\d{1,3})\]\s*(.+)$/);
    if (labeled) return `${Number(labeled[1])}. ${labeled[2].trim()}`;
    return `${index + 1}. ${entry}`;
  });
}

function splitBracketedReferences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const matches = Array.from(normalized.matchAll(/\[(\d{1,3})\]/g));
  const entries: string[] = [];

  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index!;
    const end = i + 1 < matches.length ? matches[i + 1].index! : normalized.length;
    const referenceNumber = Number(matches[i][1]);
    const rawEntry = normalized
      .slice(start, end)
      .replace(/^\[\d{1,3}\]\s*/, '')
      .trim();
    const { entry, terminate } = trimReferenceEntryCruft(rawEntry);
    if (entry) entries.push(`${referenceNumber}. ${entry}`);
    if (terminate) break;
  }

  return entries;
}

function splitNumberedReferences(text: string): string[] {
  const normalized = text
    .replace(/\n(?!\s*\d{1,3}\.\s+\S)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const matches = Array.from(normalized.matchAll(/(?:^|\s)(\d{1,3})\.\s+(?=\S)/g));
  const entries: string[] = [];

  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index! + (matches[i][0].startsWith(' ') ? 1 : 0);
    const end = i + 1 < matches.length ? matches[i + 1].index! : normalized.length;
    const { entry, terminate } = trimReferenceEntryCruft(normalized.slice(start, end).trim());
    if (entry) entries.push(entry);
    if (terminate) break;
  }

  return entries;
}

function splitAuthorYearReferences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const starts = new Set<number>([0]);
  const authorStartRe =
    /(?<=\.)\s+(?=[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'´`.-]+,\s+(?:[A-Z]\.|[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'´`.-]+).*?\(\d{4}[a-z]?\)\.)/g;

  for (const match of normalized.matchAll(authorStartRe)) {
    starts.add(match.index! + match[0].length);
  }

  const sorted = Array.from(starts).sort((a, b) => a - b);
  if (sorted.length < 2) return [];

  const entries: string[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const entry = normalized.slice(sorted[i], sorted[i + 1] ?? normalized.length).trim();
    if (entry) entries.push(`${i + 1}. ${entry}`);
  }
  return entries;
}

function trimReferenceEntryCruft(entry: string): { entry: string; terminate: boolean } {
  const captionAfterPageLocator = entry.match(
    /\.\s+\d+(?:,\s*\d+)*\s+(?=(?:(?:Figure|Fig\.?|Table|Appendix)\s+(?:\d+|[A-Z]\.|[IVXLCDM]+)(?:\s*[:.]|\b)|[-*+]\s+[A-Z][^:]{1,80}:))/i
  );
  if (captionAfterPageLocator?.index !== undefined) {
    return {
      entry: entry
        .slice(0, captionAfterPageLocator.index + captionAfterPageLocator[0].trimEnd().length)
        .trim(),
      terminate: true,
    };
  }

  const headingMatch = entry.match(/\s+#{1,6}\s+\S/);
  if (headingMatch?.index !== undefined) {
    return {
      entry: entry.slice(0, headingMatch.index).trim(),
      terminate: true,
    };
  }

  const trailingCaption = trimTrailingCaptionJunk(entry);
  if (trailingCaption) return trailingCaption;

  return { entry, terminate: false };
}

/**
 * A reference ends at its publication year; a running header, bold figure
 * legend, numbered figure/table caption, or extraction-glyph garble that follows
 * one was pulled in across a page break (e.g. the last reference absorbing the
 * appendix figures). Cut back to the terminal `(YEAR)` and stop the list, so the
 * trailing captions are never emitted as fake entries. Requiring a preceding
 * year keeps legitimate mid-title Greek letters or emphasis from tripping this.
 */
function trimTrailingCaptionJunk(entry: string): { entry: string; terminate: boolean } | undefined {
  const junk = entry.match(/\s\*\*|\s[εϵ]|\b(?:Fig(?:ure|\.)|Tab(?:le|\.))\s+\d/);
  if (junk?.index === undefined) return undefined;

  const head = entry.slice(0, junk.index);
  const years = Array.from(head.matchAll(/\((?:19|20)\d{2}[a-z]?\)/g));
  const lastYear = years[years.length - 1];
  if (lastYear?.index === undefined) return undefined;

  return {
    entry: entry.slice(0, lastYear.index + lastYear[0].length).trim(),
    terminate: true,
  };
}

function equationLinesToMathBlock(lines: string[]): string[] {
  const trimmedLines = lines
    .map((line) => line.trim())
    .filter((line) => line && !/<!--\s*PAGE_BREAK\s*-->/i.test(line));

  const lastIndex = trimmedLines.length - 1;
  const label = equationLabelForLine(trimmedLines[lastIndex]);
  if (label) {
    trimmedLines[lastIndex] = trimmedLines[lastIndex]
      .replace(/(?:^|[\s,.;])\(\d{1,3}\)(?:\s*(?:where\b.*)?|\s*)$/i, '')
      .replace(/[,.]\s*$/, '')
      .trim();
  }

  const latexLines = repairEquationLatexLines(
    trimmedLines.map(equationSegmentForMath).map(normalizeEquationLatexLine).filter(Boolean)
  );
  const body =
    latexLines.length > 1
      ? [
          '\\begin{aligned}',
          ...latexLines.map((line, index) =>
            index + 1 < latexLines.length ? `${line} \\\\` : line
          ),
          '\\end{aligned}',
        ]
      : latexLines;

  if (label) body.push(`\\tag{${label}}`);

  return ['', '$$', ...body, '$$', ''];
}

function repairEquationLatexLines(lines: string[]): string[] {
  const repaired: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const sum = lines[i].match(/^\\sum(?:\s*\^\s*([A-Za-z0-9{}\\]+))?$/);
    if (sum && i + 1 < lines.length) {
      const lower = normalizeEquationLimitLine(lines[i + 1]);
      if (lower) {
        const upper = sum[1] ? `^{${sum[1].replace(/[{}]/g, '')}}` : '';
        repaired.push(`\\sum_{${lower}}${upper}`);
        i += 1;
        continue;
      }
    }
    if (/^[*+\-/]\s*\S/.test(lines[i]) && repaired.length > 0) {
      repaired[repaired.length - 1] = `${repaired[repaired.length - 1]} ${lines[i]}`;
      continue;
    }
    repaired.push(lines[i]);
  }

  return repaired;
}

function normalizeEquationLimitLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 40) return undefined;
  if (/^(?:\\sum|\\begin|\\end|\\tag)/.test(trimmed)) return undefined;
  if (/^[A-Za-z](?:[A-Za-z0-9,]|\s|\\hat\{[A-Za-z]\}){0,12}$/.test(trimmed)) {
    return trimmed.replace(/\s+/g, ' ');
  }
  if (!/[=\\]|\\in|\\ne/.test(trimmed)) return undefined;
  return trimmed.replace(/\s+/g, ' ');
}

function equationLabelForLine(line: string): string | undefined {
  const match = line.match(/(?:^|[\s,.;])\((\d{1,3})\)(?:\s*(?:where\b.*)?|\s*)$/i);
  return match?.[1];
}

function containsEquationLabel(line: string): boolean {
  return /(?:^|[\s,.;])\(\d{1,3}\)/.test(line);
}

function splitInlineLabeledEquation(line: string): string[] | undefined {
  if (line.length < 40 || !line.includes('=')) return undefined;

  for (const labelMatch of line.matchAll(/\((\d{1,3})\)/g)) {
    const labelIndex = labelMatch.index!;

    const beforeLabel = line.slice(0, labelIndex).trimEnd();
    const equationStart = equationStartIndex(beforeLabel);
    if (equationStart < 0) continue;

    const prefix = beforeLabel.slice(0, equationStart).trimEnd();
    const equation = beforeLabel
      .slice(equationStart)
      .replace(/[,.]\s*$/, '')
      .trim();
    if (!looksLikeEquationLine(equation)) continue;

    const afterLabel = line.slice(labelIndex + labelMatch[0].length).trimStart();
    const repaired = prefix
      ? [prefix, ...equationLinesToMathBlock([`${equation} (${labelMatch[1]})`])]
      : equationLinesToMathBlock([`${equation} (${labelMatch[1]})`]);
    if (afterLabel) repaired.push(afterLabel);
    return repaired;
  }

  return undefined;
}

function equationStartIndex(text: string): number {
  const assignmentMatches = Array.from(
    text.matchAll(/[A-Za-zΑ-Ωα-ω][A-Za-z0-9Α-Ωα-ω^_{}(),|]*\s*=/g)
  );
  for (let i = assignmentMatches.length - 1; i >= 0; i -= 1) {
    const index = assignmentMatches[i].index!;
    const prefix = text.slice(0, index).trim();
    if (!prefix) return index;
    if (prefix.split(/\s+/).filter(Boolean).length >= 3) return index;
  }
  return -1;
}

function equationSegmentForMath(line: string): string {
  const colonIndex = line.lastIndexOf(':');
  if (colonIndex >= 0) {
    const suffix = line.slice(colonIndex + 1).trim();
    if (looksLikeEquationContextLine(suffix)) return suffix;
  }

  const equationStart = line.search(/[A-Za-z][A-Za-z0-9^_{}(),|]*\s*=/);
  if (equationStart > 0) {
    const prefix = line.slice(0, equationStart).trim();
    const suffix = line.slice(equationStart).trim();
    if (prefix.split(/\s+/).filter(Boolean).length >= 4 && looksLikeEquationContextLine(suffix)) {
      return suffix;
    }
  }

  return line;
}

function normalizeEquationLatexLine(line: string): string {
  return replaceEquationControlGlyphs(line)
    .replace(/∆/g, '\\Delta ')
    .replace(/∑/g, '\\sum ')
    .replace(/√/g, '\\sqrt ')
    .replace(/∫/g, '\\int ')
    .replace(/≤/g, '\\le ')
    .replace(/≥/g, '\\ge ')
    .replace(/≈/g, '\\approx ')
    .replace(/±/g, '\\pm ')
    .replace(/−/g, '-')
    .replace(/×/g, '\\times ')
    .replace(/÷/g, '\\div ')
    .replace(/∈/g, '\\in ')
    .replace(/∪/g, '\\cup ')
    .replace(/∞/g, '\\infty ')
    .replace(/α/g, '\\alpha ')
    .replace(/β/g, '\\beta ')
    .replace(/γ/g, '\\gamma ')
    .replace(/ε/g, '\\epsilon ')
    .replace(/θ/g, '\\theta ')
    .replace(/λ/g, '\\lambda ')
    .replace(/μ/g, '\\mu ')
    .replace(/π/g, '\\pi ')
    .replace(/φ/g, '\\phi ')
    .replace(/ϵ/g, '\\epsilon ')
    .replace(/∗/g, '*')
    .replace(/ˆ\s*([A-Za-z])/g, '\\hat{$1}')
    .replace(/ˆ(?=[\s),}\]]|$)/g, '')
    .replace(/\b6\s*=/g, '\\ne ')
    .replace(/\s+-\^\s+/g, ' - ')
    .replace(/\^\s+(?=[+\-*/=)]|$)/g, ' ')
    .replace(/([A-Za-z0-9})])\^(\s|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function replaceEquationControlGlyphs(line: string): string {
  return Array.from(line)
    .map((char) => (char.charCodeAt(0) === 15 ? '\\epsilon ' : char))
    .join('');
}

function equationLabelRe(): RegExp {
  return /(?:^|[\s,.;])\(\d{1,3}\)(?:\s*(?:where\b.*)?|\s*)$/i;
}

function looksLikeEquationLine(line: string): boolean {
  const mathSymbols = (line.match(/[=+*∑√∫≈≤≥±−×÷<>|{}^_]|\\(?:frac|sum|sqrt|int)/g) ?? []).length;
  const words = (line.match(/[A-Za-z]{3,}/g) ?? []).length;
  if (mathSymbols >= 2) return words <= 24;
  return mathSymbols === 1 && words <= 1;
}

function equationBlockStart(lines: string[], labelIndex: number): number {
  let start = labelIndex;
  for (let i = labelIndex - 1; i >= 0 && labelIndex - i <= 16; i -= 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      continue;
    }
    if (/<!--\s*PAGE_BREAK\s*-->/i.test(trimmed)) continue;
    if (containsEquationLabel(trimmed)) break;
    if (looksLikeReferenceHeading(trimmed) || figureCaptionForLine(trimmed)) {
      break;
    }
    if (/^(?:Table|Tab\.?)\s+(?:\d+|[IVXLCDM]+)(?:\s*[:.]|\b)/i.test(trimmed)) break;
    if (isEquationBlockBoundary(trimmed)) break;
    if (looksLikeEquationContextLine(trimmed)) {
      start = i;
      continue;
    }
    break;
  }
  return start;
}

function isEquationBlockBoundary(line: string): boolean {
  return (
    /^(?:#{1,6}\s|[-*+]\s|\d+\.\s|>\s|!\[|\[|<!--|```|~~~)/.test(line) ||
    /^\|\s*[^|]+\s+\|\s*[^|]+/.test(line)
  );
}

function looksLikeEquationContextLine(line: string): boolean {
  if (line.length > 120) return false;
  const mathSymbols = (line.match(/[=+*∑√∫≈≤≥±−×÷<>|{}^_]|\\(?:frac|sum|sqrt|int)/g) ?? []).length;
  const words = (line.match(/[A-Za-z]{3,}/g) ?? []).length;
  return mathSymbols >= 2 || words <= 3;
}

function figurePagesForLayout(layoutText: string): Map<string, number> {
  const pages = new Map<string, number>();
  for (const [index, page] of layoutText.split('\f').entries()) {
    for (const line of page.split(/\r?\n/)) {
      const caption = figureCaptionForLine(line);
      if (caption && !pages.has(caption)) pages.set(caption, index + 1);
    }
  }
  return pages;
}

/**
 * Figure id → its page and the full caption text recovered from the layout.
 * The page key matches {@link figurePagesForLayout} (first caption occurrence),
 * so which figures count as missing is unchanged — only the placeholder text
 * gains the real caption. Caption text is only captured when the layout line
 * starts with the figure marker, not for in-prose mentions.
 */
function figureCaptionsForLayout(
  layoutText: string
): Map<string, { page: number; caption: string }> {
  const captions = new Map<string, { page: number; caption: string }>();
  for (const [index, page] of layoutText.split('\f').entries()) {
    const lines = page.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      // Only a caption-position line registers a figure. An in-text mention
      // ("… In Fig. 5, we compare …") must not shadow the real caption on a
      // later page with an empty entry and the wrong page number.
      if (!isFigureCaptionLine(lines[i])) continue;
      const figure = figureCaptionForLine(lines[i]);
      if (!figure || captions.has(figure)) continue;
      captions.set(figure, { page: index + 1, caption: collectLayoutCaption(lines, i) });
    }
  }
  return captions;
}

function collectLayoutCaption(lines: string[], startIndex: number): string {
  const parts = [lines[startIndex].trim()];
  for (let i = startIndex + 1; i < lines.length && parts.length < 8; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed || isCaptionContinuationBoundary(trimmed)) break;
    parts.push(trimmed);
  }
  return dehyphenateCaption(parts);
}

function isCaptionContinuationBoundary(line: string): boolean {
  return (
    /^\d{1,4}\s+[A-Z]/.test(line) || // running header, e.g. "18   M. Liang et al."
    /^(?:Figure|Fig\.?|Table|Tab\.?|Chart)\s+\d/i.test(line) || // next caption
    /^(?:#{1,6}\s|\d+(?:\.\d+)?\.?\s+[A-Z][a-z])/.test(line) || // section heading
    /^\[\d{1,3}\]/.test(line) || // reference entry
    /\(\d{1,3}\)\s*$/.test(line) // a display equation ending in a (N) label
  );
}

function dehyphenateCaption(parts: string[]): string {
  let text = '';
  for (const part of parts) {
    if (!text) {
      text = part;
      continue;
    }
    text = /[A-Za-z]-$/.test(text) ? `${text.slice(0, -1)}${part}` : `${text} ${part}`;
  }
  return text.replace(/\s+/g, ' ').trim();
}

function equationPagesForLayout(layoutText: string): Map<string, number> {
  const pages = new Map<string, number>();
  for (const [equation, recovered] of equationsForLayout(layoutText).entries()) {
    if (!pages.has(equation)) pages.set(equation, recovered.page);
  }
  return pages;
}

function equationsForLayout(layoutText: string): Map<string, { page: number; markdown: string }> {
  const equations = new Map<string, { page: number; markdown: string }>();
  for (const [pageIndex, page] of layoutText.split('\f').entries()) {
    const lines = page.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      const match = trimmed.match(/\((\d{1,3})\)\s*\.?\s*$/);
      if (!match) continue;
      if (
        !looksLikeEquationLine(trimmed) &&
        equationBlockStart(lines, i) === i &&
        !hasNearbyEquationContext(lines, i)
      ) {
        continue;
      }

      if (equations.has(match[1])) continue;

      const block = layoutEquationBlock(lines, i);
      const markdown = equationLinesToMathBlock(block).join('\n').trim();
      if (markdown && !/Equation not extracted/i.test(markdown)) {
        equations.set(match[1], { page: pageIndex + 1, markdown });
      }
    }
  }
  return equations;
}

function layoutEquationBlock(lines: string[], labelIndex: number): string[] {
  const blockStart = equationBlockStart(lines, labelIndex);
  const block = lines
    .slice(blockStart, labelIndex + 1)
    .map((line) => line.trim())
    .filter(Boolean);

  if (block.length > 0) return block;
  return [lines[labelIndex].trim()];
}

function hasNearbyEquationContext(lines: string[], lineIndex: number): boolean {
  const start = Math.max(0, lineIndex - 8);
  const context = lines
    .slice(start, lineIndex + 1)
    .map((line) => line.trim())
    .join(' ');
  return (context.match(/[=∑√∫≈≤≥±−×÷<>|{}^_]|\\(?:frac|sum|sqrt|int)/g) ?? []).length >= 2;
}

function figuresInMarkdown(markdown: string): Set<string> {
  const figures = new Set<string>();
  for (const line of markdown.split(/\r?\n/)) {
    const caption = figureCaptionForLine(line);
    if (caption && isFigureCaptionLine(line)) figures.add(caption);
  }
  return figures;
}

/**
 * Whether a line is a genuine figure caption rather than an in-text reference.
 * A caption's marker either starts the line or follows a short title prefix
 * ("Overview Figure 7. …"); a reference is preceded by a preposition ("… in
 * Fig. 5, we compare …"). Only genuine captions count a figure as present, so a
 * recovered caption is not suppressed — nor a source link misplaced — by a
 * passing mention.
 */
function isFigureCaptionLine(line: string): boolean {
  if (!figureCaptionForLine(line)) return false;
  const marker = line.match(/\b(?:Figure|Fig\.?|Chart)\s+(?:S\.\d+|\d+(?:\.\d+)?)/i);
  if (marker?.index === undefined) return false;
  const wordBefore =
    line
      .slice(0, marker.index)
      .trim()
      .match(/(\S+)$/)?.[1] ?? '';
  return !/^(?:in|on|see|from|of|to|and|via|cf\.?|figs?\.?)$/i.test(wordBefore);
}

function equationsInMarkdown(markdown: string): Set<string> {
  const equations = new Set<string>();
  for (const line of markdown.split(/\r?\n/)) {
    for (const tagMatch of line.matchAll(/\\tag\{(\d{1,3})\}/g)) {
      equations.add(tagMatch[1]);
    }
    const match = line.trim().match(/\((\d{1,3})\)(?:\s*(?:where\b.*)?|\s*)$/i);
    if (match && /Equation source\s*=/.test(line)) {
      equations.add(match[1]);
    }
  }
  return equations;
}

function appendToMarkdownPageSection(sections: string[], page: number, text: string): string[] {
  const sectionIndex = Math.max(0, Math.min(sections.length - 1, (page - 1) * 2));
  const section = sections[sectionIndex];
  const referencesBoundary =
    /^## References\b/m.test(section) && !/^## Extracted Source Placeholders\b/m.test(section)
      ? '\n\n## Extracted Source Placeholders\n\n'
      : '';
  const separator = referencesBoundary || (section.endsWith('\n') ? '\n' : '\n\n');
  const updated = [...sections];
  updated[sectionIndex] = `${section}${separator}${text}\n`;
  return updated;
}

function figureCaptionForLine(line: string): string | undefined {
  const trimmed = line.trim().replace(/^\*+|\*+$/g, '');
  if (!trimmed) return undefined;

  const match = trimmed.match(/\b(?:Figure|Fig\.?|Chart)\s+(S\.\d+|\d+(?:\.\d+)?)(?:\s*[:.]|\b)/i);
  if (!match) return undefined;
  if (/^(?:Figure|Fig\.?|Chart)\s+/i.test(trimmed)) return normalizedFigureId(match);
  if (/^(?:\([a-z0-9^]+\)\s*){1,8}(?:Figure|Fig\.?|Chart)\s+/i.test(trimmed)) {
    return normalizedFigureId(match);
  }

  const prefix = trimmed.slice(0, match.index!).trim();
  if (/[.!?]$/.test(prefix)) return undefined;
  if (match.index! > 36 || prefix.split(/\s+/).filter(Boolean).length > 4) return undefined;
  return normalizedFigureId(match);
}

function normalizedFigureId(match: RegExpMatchArray): string {
  return match[1].toUpperCase();
}

function nextNonEmptyLine(lines: string[], startIndex: number): string {
  for (let i = startIndex; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function canJoinParagraphLines(previousLine: string, nextLine: string): boolean {
  const previous = previousLine.trim();
  const next = nextLine.trim();
  if (!previous || !next) return false;
  if (isStructuralLine(previous) || isStructuralLine(next)) return false;
  if (figureCaptionForLine(previous) || figureCaptionForLine(next)) return false;
  if (looksLikeEquationLine(previous) || looksLikeEquationLine(next)) return false;
  if (/[:.!?]$/.test(previous) && /^[A-Z0-9]/.test(next)) return false;
  return true;
}

function isStructuralLine(line: string): boolean {
  return (
    /^(?:#{1,6}\s|[-*+]\s|\d+\.\s|>\s|!\[|\[|<!--|\||```|~~~)/.test(line) ||
    /^(?:Table|Tab\.?)\s+(?:\d+|[IVXLCDM]+)(?:\s*[:.]|\b)/i.test(line)
  );
}

function compactExcessBlankLines(lines: string[]): string[] {
  const compacted: string[] = [];
  for (const line of lines) {
    if (!line.trim() && compacted[compacted.length - 1]?.trim() === '') continue;
    compacted.push(line);
  }
  return compacted;
}

function isMarkdownPipeRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isMarkdownSeparatorLine(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
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
