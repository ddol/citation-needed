import { execFile } from 'child_process';

interface TextSegment {
  text: string;
  start: number;
  end: number;
}

interface LayoutTable {
  number: string;
  markdown: string;
}

const CAPTION_RE = /^\s*Table\s+(\d+)\s*:/;
const LAYOUT_CAPTION_RE = /\bTable\s+(\d+)\s*:/;

export function extractPdfLayoutText(pdfPath: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      'pdftotext',
      ['-layout', pdfPath, '-'],
      { maxBuffer: 50 * 1024 * 1024 },
      (error, stdout) => {
        resolve(error ? undefined : stdout);
      }
    );
  });
}

export function repairMarkdownTablesWithLayout(markdown: string, layoutText?: string): string {
  if (!layoutText) return markdown;

  const tables = extractLayoutTables(layoutText);
  if (tables.length === 0) return markdown;

  const lines = markdown.split('\n');
  const usedTables = new Set<LayoutTable>();

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(CAPTION_RE);
    if (!match) continue;

    const table = tables.find(
      (candidate) => candidate.number === match[1] && !usedTables.has(candidate)
    );
    if (!table) continue;

    const previous = previousNonEmptyLine(lines, i);
    if (previous === undefined || lines[previous].trim().startsWith('|')) continue;

    lines[previous] = table.markdown;
    usedTables.add(table);
  }

  return lines.join('\n');
}

function extractLayoutTables(layoutText: string): LayoutTable[] {
  return layoutText
    .split('\f')
    .flatMap((page) => extractPageLayoutTables(page.split(/\r?\n/).map((line) => line.trimEnd())));
}

function extractPageLayoutTables(lines: string[]): LayoutTable[] {
  const tables: LayoutTable[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(LAYOUT_CAPTION_RE);
    if (!match) continue;

    const block = collectBlockAboveCaption(lines, i, match.index ?? 0);
    const markdown = layoutBlockToMarkdown(block);
    if (markdown) {
      tables.push({ number: match[1], markdown });
    }
  }

  return tables;
}

function collectBlockAboveCaption(
  lines: string[],
  captionIndex: number,
  captionIndent: number
): string[] {
  const cropStart = inferTableStart(lines, captionIndex, captionIndent);
  const block: string[] = [];
  let skippedBlankLines = 0;

  for (let i = captionIndex - 1; i >= 0; i -= 1) {
    const raw = lines[i];
    if (!raw.trim()) {
      if (block.length > 0 && cropStart === 0) break;
      if (block.length > 0) {
        skippedBlankLines += 1;
        if (skippedBlankLines > 8) break;
      }
      continue;
    }
    if (/\b(Table|Figure)\s+\d+\s*:/.test(raw)) break;

    const cropped = raw.slice(cropStart).trimEnd();
    if (cropped.trim()) {
      block.unshift(cropped);
      skippedBlankLines = 0;
    }
    if (block.length >= 40) break;
  }

  return block;
}

function inferTableStart(lines: string[], captionIndex: number, captionIndent: number): number {
  if (captionIndent < 30) return 0;

  const starts: number[] = [];
  for (let i = captionIndex - 1; i >= Math.max(0, captionIndex - 40); i -= 1) {
    if (/\b(Table|Figure)\s+\d+\s*:/.test(lines[i])) break;

    const segments = segmentsForLine(lines[i]);
    const lineStarts: number[] = [];
    for (let j = 0; j < segments.length; j += 1) {
      const rightSegments = segments.slice(j);
      if (
        rightSegments.length >= 3 &&
        rightSegments[0].start <= captionIndent + 8 &&
        rightSegments[rightSegments.length - 1].end >= captionIndent &&
        rightSegments.some((segment) => /\d/.test(segment.text))
      ) {
        lineStarts.push(rightSegments[0].start);
      }
    }
    if (lineStarts.length > 0) starts.push(Math.max(...lineStarts));
  }

  if (starts.length === 0) return Math.max(0, captionIndent - 8);
  starts.sort((a, b) => a - b);
  return starts[starts.length - 1];
}

function layoutBlockToMarkdown(lines: string[]): string | undefined {
  const segmentedRows = lines
    .map((line) => segmentsForLine(line))
    .filter((segments) => segments.length > 0 && !looksLikeProseSegments(segments));
  if (segmentedRows.filter((segments) => segments.length >= 2).length < 2) return undefined;

  const width = mostCommonWidth(segmentedRows);
  if (width < 2) return undefined;

  const anchorRowIndex = segmentedRows.findIndex((segments) => segments.length === width);
  if (anchorRowIndex < 0) return undefined;

  const anchors = segmentedRows[anchorRowIndex].map((segment) => segment.start);
  const headerRows = segmentedRows.slice(0, anchorRowIndex);
  const bodyRows = segmentedRows
    .slice(anchorRowIndex)
    .map((segments) => mapSegmentsToColumns(segments, anchors))
    .filter((row) => row.filter(Boolean).length >= 2);

  if (bodyRows.length < 1) return undefined;

  const header = buildHeader(headerRows, anchors);
  const [finalHeader, finalBody] =
    header.filter(Boolean).length >= 2
      ? [header.map((cell, index) => cell || `Column ${index + 1}`), bodyRows]
      : [bodyRows[0], bodyRows.slice(1)];

  if (finalBody.length < 2 || finalHeader.length !== width || !hasNumericBody(finalBody)) {
    return undefined;
  }

  return [
    formatMarkdownRow(finalHeader),
    formatMarkdownRow(Array.from({ length: width }, () => '---')),
    ...finalBody.map(formatMarkdownRow),
  ].join('\n');
}

function hasNumericBody(rows: string[][]): boolean {
  const numericRows = rows.filter((row) => row.some((cell) => /\d/.test(cell)));
  const packedNumericCell = rows.some((row) =>
    row.some((cell) => (cell.match(/\d+(?:\.\d+)?/g) ?? []).length > 4)
  );
  return numericRows.length >= Math.ceil(rows.length / 2) && !packedNumericCell;
}

function segmentsForLine(line: string): TextSegment[] {
  const matches = line.matchAll(/\S+(?: \S+)*/g);
  return Array.from(matches, (match) => ({
    text: normalizeCell(match[0]),
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function looksLikeProseSegments(segments: TextSegment[]): boolean {
  const text = segments.map((segment) => segment.text).join(' ');
  const words = text.split(/\s+/).filter(Boolean);
  const numberCount = (text.match(/\d+(?:\.\d+)?/g) ?? []).length;
  return segments.length <= 2 && words.length >= 7 && numberCount < 2;
}

function mostCommonWidth(rows: TextSegment[][]): number {
  const counts = new Map<number, number>();
  for (const row of rows) {
    counts.set(row.length, (counts.get(row.length) ?? 0) + 1);
  }

  let width = 0;
  let count = 0;
  for (const [candidateWidth, candidateCount] of counts) {
    if (
      candidateWidth >= 2 &&
      (candidateCount > count || (candidateCount === count && candidateWidth > width))
    ) {
      width = candidateWidth;
      count = candidateCount;
    }
  }
  return count >= 2 ? width : 0;
}

function buildHeader(headerRows: TextSegment[][], anchors: number[]): string[] {
  const header = Array.from({ length: anchors.length }, () => '');

  for (const row of headerRows) {
    for (const segment of row) {
      const column = columnForSegment(segment, anchors);
      header[column] = [header[column], segment.text].filter(Boolean).join(' ');
    }
  }

  return header.map(normalizeCell);
}

function mapSegmentsToColumns(segments: TextSegment[], anchors: number[]): string[] {
  const cells = Array.from({ length: anchors.length }, () => '');

  for (const segment of segments) {
    const column = columnForSegment(segment, anchors);
    cells[column] = [cells[column], segment.text].filter(Boolean).join(' ');
  }

  return cells.map(normalizeCell);
}

function columnForSegment(segment: TextSegment, anchors: number[]): number {
  const center = (segment.start + segment.end) / 2;
  let column = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < anchors.length; i += 1) {
    const distance = Math.abs(center - anchors[i]);
    if (distance < bestDistance) {
      bestDistance = distance;
      column = i;
    }
  }

  return column;
}

function previousNonEmptyLine(lines: string[], fromIndex: number): number | undefined {
  for (let i = fromIndex - 1; i >= 0; i -= 1) {
    if (lines[i].trim()) return i;
  }
  return undefined;
}

function normalizeCell(cell: string): string {
  return cell.replace(/\s+/g, ' ').trim();
}

function formatMarkdownRow(cells: string[]): string {
  return `| ${cells.map(escapeTableCell).join(' | ')} |`;
}

function escapeTableCell(cell: string): string {
  return cell.replace(/\\?\|/g, (match) => (match === '\\|' ? match : '\\|'));
}
