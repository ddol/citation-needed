import { execFile } from 'child_process';

interface TextSegment {
  text: string;
  start: number;
  end: number;
}

interface LayoutTable {
  number: string;
  markdown: string;
  placement: 'above' | 'below';
}

const TABLE_ID_RE = String.raw`(\d+|[IVXLCDM]+)`;
const CAPTION_RE = new RegExp(String.raw`\b(?:Table|Tab\.?)\s+${TABLE_ID_RE}(?:\s*[:.]|\b)`, 'i');
const LAYOUT_CAPTION_RE = new RegExp(
  String.raw`\b(?:Table|Tab\.?)\s+${TABLE_ID_RE}(?:\s*[:.]|\b)`,
  'i'
);

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

    const captionIndex = match.index!;
    const prefix = lines[i].slice(0, captionIndex).trim();
    const prefixIsOnlyEmphasis = /^\*+$/.test(prefix);
    if (table.placement === 'below') {
      const caption = lines[i].slice(captionIndex).trimStart();
      lines[i] =
        prefix && !prefixIsOnlyEmphasis
          ? `${prefix}\n\n${caption}\n\n${table.markdown}`
          : `${lines[i]}\n\n${table.markdown}`;
      clearFollowingCollapsedTableLines(lines, i + 1);
      usedTables.add(table);
      continue;
    }

    if (prefix && !prefixIsOnlyEmphasis && looksLikeCollapsedTableLine(prefix)) {
      lines[i] = `${table.markdown}\n${lines[i].slice(captionIndex).trimStart()}`;
      usedTables.add(table);
      continue;
    }

    const previous = previousNonEmptyLine(lines, i);
    if (previous === undefined || lines[previous].trim().startsWith('|')) continue;

    lines[previous] = table.markdown;
    usedTables.add(table);
  }

  return lines.join('\n');
}

function clearFollowingCollapsedTableLines(lines: string[], startIndex: number): void {
  let firstRemovableIndex = startIndex;
  let removeCount = 0;
  for (let i = startIndex; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      if (removeCount === 0) {
        firstRemovableIndex = i;
        continue;
      }
      break;
    }
    if (
      /^(?:#{1,6}\s|<!--|(?:Table|Tab\.?|Figure|Fig\.?)\s+(?:\d+|[IVXLCDM]+)(?:\s*[:.]|\b))/i.test(
        trimmed
      )
    ) {
      break;
    }
    if (
      !looksLikeCollapsedTableLine(trimmed) &&
      !looksLikeCategoricalCollapsedTableLine(trimmed) &&
      !looksLikePackedTableLine(trimmed) &&
      !looksLikePipeTableFragment(trimmed)
    ) {
      break;
    }
    removeCount = i - firstRemovableIndex + 1;
  }

  if (removeCount > 0) {
    lines.splice(firstRemovableIndex, removeCount);
  }
}

function looksLikePackedTableLine(line: string): boolean {
  const tokens = line.split(/\s+/).filter(Boolean);
  const numericTokens = tokens.filter((token) => /\d/.test(token)).length;
  return tokens.length >= 5 && numericTokens >= 2 && !/[.!?]$/.test(line);
}

function looksLikeCategoricalCollapsedTableLine(line: string): boolean {
  const tokens = line.split(/\s+/).filter(Boolean);
  const numericTokens = tokens.filter((token) => /\d/.test(token)).length;
  const shortTokens = tokens.filter((token) => token.length <= 18).length;
  return (
    tokens.length >= 6 &&
    numericTokens <= 1 &&
    shortTokens >= tokens.length - 1 &&
    !/[.!?]$/.test(line)
  );
}

function looksLikePipeTableFragment(line: string): boolean {
  return (line.match(/\|/g) ?? []).length >= 2;
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

    const aboveBlock = collectBlockAboveCaption(lines, i, match.index!);
    const above = layoutBlockToMarkdown(aboveBlock);
    if (above) {
      tables.push({ number: match[1], markdown: above, placement: 'above' });
      continue;
    }

    // A grouped ablation table's caption always sits above its data, so recover
    // it only from the below-caption block. Running it on the above block would
    // wrongly re-parse the preceding table when two share a page.
    const belowBlock = collectBlockBelowCaption(lines, i);
    const below = layoutBlockToMarkdown(belowBlock) ?? packedGroupedTableToMarkdown(belowBlock);
    if (below) {
      tables.push({ number: match[1], markdown: below, placement: 'below' });
    }
  }

  return tables;
}

function collectBlockBelowCaption(lines: string[], captionIndex: number): string[] {
  const block: string[] = [];
  let skippedBlankLines = 0;

  for (let i = captionIndex + 1; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed) {
      if (block.length > 0) {
        skippedBlankLines += 1;
        if (skippedBlankLines > 2) break;
      }
      continue;
    }

    if (/\b(?:Table|Tab\.?|Figure|Fig\.?)\s+(?:\d+|[IVXLCDM]+)(?:\s*[:.]|\b)/i.test(trimmed)) break;
    if (/^(?:[A-Z]\.|[IVXLCDM]+\.|\d+\.|References\b)/.test(trimmed) && block.length >= 2) break;
    if (block.length === 0 && !looksLikeTableStartLine(raw)) continue;
    if (block.length >= 1 && looksLikeParagraphLine(trimmed)) break;

    block.push(raw.trimEnd());
    skippedBlankLines = 0;
    if (block.length >= 40) break;
  }

  return block;
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
    if (/\b(Table|Figure)\s+\d+(?:\s*:|\b)/.test(raw)) break;

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
    if (/\b(Table|Figure)\s+\d+(?:\s*:|\b)/.test(lines[i])) break;

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
  // A header whose columns are separated by single spaces collapses to one
  // segment (e.g. `ActorNet MapNet L2A … minFDE`), so column anchoring can only
  // produce a mangled grid. Bail to the preformatted fallback instead.
  if (hasPackedHeaderRow(lines)) return undefined;

  const segmentedRows = lines
    .map((line) => segmentsForLine(line))
    .filter((segments) => segments.length > 0 && !looksLikeProseSegments(segments));
  if (segmentedRows.filter((segments) => segments.length >= 2).length < 2) return undefined;

  const width = mostCommonWidth(segmentedRows);
  if (width < 2) return undefined;

  const anchorRowIndex = segmentedRows.findIndex((segments) => segments.length === width);

  const anchors = segmentedRows[anchorRowIndex].map((segment) => segment.start);
  const headerRows = segmentedRows.slice(0, anchorRowIndex);
  const bodyRows = segmentedRows
    .slice(anchorRowIndex)
    .map((segments) => mapSegmentsToColumns(segments, anchors))
    .filter((row) => row.filter(Boolean).length >= 2);

  const header = buildHeader(headerRows, anchors);
  const [finalHeader, finalBody] =
    header.filter(Boolean).length >= 2
      ? [header.map((cell, index) => cell || `Column ${index + 1}`), bodyRows]
      : [bodyRows[0], bodyRows.slice(1)];

  if (finalBody.length < 2 || !hasTabularBody(finalBody)) {
    return undefined;
  }

  return [
    formatMarkdownRow(finalHeader),
    formatMarkdownRow(Array.from({ length: width }, () => '---')),
    ...finalBody.map(formatMarkdownRow),
  ].join('\n');
}

/**
 * True when a row packs six or more short column labels with single spaces, so
 * `segmentsForLine` (which only splits on runs of two-plus spaces) can't see the
 * columns. Multi-space-separated headers segment cleanly and are not flagged.
 */
function hasPackedHeaderRow(lines: string[]): boolean {
  return lines.some((line) => {
    const spaceTokens = line.trim().split(/\s+/).filter(Boolean);
    if (spaceTokens.length < 6 || !spaceTokens.every((token) => token.length <= 12)) {
      return false;
    }
    return segmentsForLine(line).length * 3 <= spaceTokens.length;
  });
}

interface PositionedToken {
  text: string;
  center: number;
}

/**
 * Recover a real Markdown table from an ablation-style block whose leaf header is
 * packed with single spaces (`ActorNet MapNet L2A … minFDE`) over group labels
 * (`Backbone FusionNet K=1 K=6`). `pdftotext -layout` compresses the sparse `X`
 * marks so they no longer sit under their header column, but it preserves their
 * left-to-right order — so a *monotonic* nearest-column assignment (each token to
 * the closest column at or after the previous token's) places every cell
 * correctly. Duplicate leaf headers are disambiguated with their group label
 * (`minADE (K=1)` vs `minADE (K=6)`).
 */
function packedGroupedTableToMarkdown(lines: string[]): string | undefined {
  const rows = lines.map((line) => line.replace(/\s+$/, '')).filter((line) => line.trim());
  const bodyStart = rows.findIndex(isPackedBodyRow);
  if (bodyStart < 1) return undefined;

  const bodyRows = rows.slice(bodyStart).filter(isPackedBodyRow);
  if (bodyRows.length < 2) return undefined;

  const leafTokens = positionedTokens(rows[bodyStart - 1]);
  if (leafTokens.length < 4) return undefined;
  const anchors = leafTokens.map((token) => token.center);
  const firstAnchor = anchors[0];
  const labelCut = firstAnchor - 4;

  // A leading label column exists when body rows carry text left of the first
  // numeric column (row names like `Argoverse Baseline [9]`), which the packed
  // leaf header does not cover. Those tokens collapse into one label cell.
  const aboveLeaf = rows.slice(0, bodyStart - 1).map(positionedTokens);
  const hasLabelColumn = bodyRows.some((row) =>
    positionedTokens(row).some((token) => token.center < labelCut)
  );

  const assigned: string[][] = [];
  for (const row of bodyRows) {
    const tokens = positionedTokens(row);
    const dataTokens = hasLabelColumn ? tokens.filter((token) => token.center >= labelCut) : tokens;
    const cells = assignMonotonic(dataTokens, anchors);
    if (!cells) return undefined; // more tokens than columns → not this shape
    const fullRow = hasLabelColumn
      ? [
          tokens
            .filter((token) => token.center < labelCut)
            .map((token) => token.text)
            .join(' '),
          ...cells,
        ]
      : cells;
    if (fullRow.filter(Boolean).length >= 2) assigned.push(fullRow);
  }
  if (assigned.length < 2) return undefined;

  const groupRow = aboveLeaf.find(
    (row) => row.length >= 2 && row.some((token) => token.center >= labelCut)
  );
  let header = qualifyPackedHeader(
    leafTokens.map((token) => token.text),
    anchors,
    groupRow
  );
  if (hasLabelColumn) {
    const labelRow = aboveLeaf.find(
      (row) => row.length >= 1 && row.every((token) => token.center < firstAnchor)
    );
    header = [labelRow ? labelRow.map((token) => token.text).join(' ') : 'Column 1', ...header];
  }

  return [
    formatMarkdownRow(header),
    formatMarkdownRow(header.map(() => '---')),
    ...assigned.map(formatMarkdownRow),
  ].join('\n');
}

/** A body row of a packed ablation table ends in a run of three or more numbers. */
function isPackedBodyRow(line: string): boolean {
  const tokens = positionedTokens(line);
  if (tokens.length < 4) return false;
  let trailing = 0;
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (/^\d+(?:\.\d+)?%?$/.test(tokens[i].text)) trailing += 1;
    else break;
  }
  return trailing >= 3;
}

function positionedTokens(line: string): PositionedToken[] {
  return Array.from(line.matchAll(/\S+/g), (match) => ({
    text: match[0],
    center: match.index! + match[0].length / 2,
  }));
}

function assignMonotonic(tokens: PositionedToken[], anchors: number[]): string[] | null {
  const cells = anchors.map(() => '');
  let minColumn = 0;
  for (const token of tokens) {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let column = minColumn; column < anchors.length; column += 1) {
      const distance = Math.abs(token.center - anchors[column]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = column;
      }
    }
    if (best < 0) return null; // ran out of columns
    cells[best] = cells[best] ? `${cells[best]} ${token.text}` : token.text;
    minColumn = best + 1;
  }
  return cells;
}

function qualifyPackedHeader(
  leafNames: string[],
  anchors: number[],
  groupRow: PositionedToken[] | undefined
): string[] {
  const duplicated = new Set(leafNames.filter((name, index) => leafNames.indexOf(name) !== index));
  const groups = groupRow ? groupLabelForColumn(anchors, groupRow) : [];

  return leafNames.map((name, index) => {
    const group = groups[index];
    return duplicated.has(name) && group ? `${name} (${group})` : name;
  });
}

/** Map each leaf column to the group label whose span (midpoints between labels) contains it. */
function groupLabelForColumn(anchors: number[], groupRow: PositionedToken[]): string[] {
  const bounds = groupRow.map((label, index) => {
    const next = groupRow[index + 1];
    return next ? (label.center + next.center) / 2 : Number.POSITIVE_INFINITY;
  });
  return anchors.map((anchor) => {
    const groupIndex = bounds.findIndex((upper) => anchor < upper);
    return groupIndex >= 0 ? groupRow[groupIndex].text : '';
  });
}

function hasNumericBody(rows: string[][]): boolean {
  const numericRows = rows.filter((row) => row.some((cell) => /\d/.test(cell)));
  const packedNumericCell = rows.some((row) =>
    row.some((cell) => (cell.match(/\d+(?:\.\d+)?/g) ?? []).length > 4)
  );
  return numericRows.length >= Math.ceil(rows.length / 2) && !packedNumericCell;
}

function hasTabularBody(rows: string[][]): boolean {
  if (hasNumericBody(rows)) return true;
  if (rows.length < 3) return false;

  const populatedRows = rows.filter((row) => row.filter(Boolean).length >= 2);
  const firstColumnValues = new Set(populatedRows.map((row) => row[0]).filter(Boolean));
  const longCells = populatedRows.flat().filter((cell) => cell.split(/\s+/).length > 8).length;
  return (
    populatedRows.length >= 3 &&
    firstColumnValues.size >= Math.min(3, populatedRows.length) &&
    longCells === 0
  );
}

function segmentsForLine(line: string): TextSegment[] {
  const matches = line.matchAll(/\S+(?: \S+)*/g);
  return Array.from(matches, (match) => {
    const start = match.index!;
    return {
      text: normalizeCell(match[0]),
      start,
      end: start + match[0].length,
    };
  });
}

function looksLikeProseSegments(segments: TextSegment[]): boolean {
  const text = segments.map((segment) => segment.text).join(' ');
  const words = text.split(/\s+/).filter(Boolean);
  const numberCount = (text.match(/\d+(?:\.\d+)?/g) ?? []).length;
  return segments.length <= 2 && words.length >= 7 && numberCount < 2;
}

function looksLikeParagraphLine(line: string): boolean {
  const words = line.split(/\s+/).filter(Boolean);
  const numberCount = (line.match(/\d+(?:\.\d+)?/g) ?? []).length;
  return words.length >= 12 && numberCount < 3 && /[.!?]$/.test(line);
}

function looksLikeTableStartLine(line: string): boolean {
  const segments = segmentsForLine(line);
  if (segments.length < 2) return false;

  const text = segments.map((segment) => segment.text).join(' ');
  const words = text.split(/\s+/).filter(Boolean);
  const numericTokens = (text.match(/\d+(?:\.\d+)?/g) ?? []).length;
  return numericTokens > 0 || words.length <= 10 || (segments.length >= 3 && words.length <= 16);
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

function looksLikeCollapsedTableLine(line: string): boolean {
  const tokens = line.split(/\s+/).filter(Boolean);
  const numericTokens = tokens.filter((token) => /\d/.test(token)).length;
  const compactHeaderTokens = tokens.filter((token) =>
    /[A-Za-z][A-Za-z/().%-]*$/.test(token)
  ).length;
  return tokens.length >= 8 && numericTokens >= 3 && compactHeaderTokens >= 2;
}
