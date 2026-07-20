import type { Style } from './output';
import { paint } from './output';

export interface CitationRow {
  doi: string;
  title?: string;
  year?: number;
  verificationStatus: string;
}

interface ColumnWidths {
  doi: number;
  title: number;
  year: number;
  status: number;
}

const DEFAULT_TERMINAL_WIDTH = 120;
const GUTTER_WIDTH = 3;
const PREFERRED_DOI_WIDTH = 30;
const PREFERRED_YEAR_WIDTH = 6;
const PREFERRED_STATUS_WIDTH = 12;
const MIN_DOI_WIDTH = 12;
const MIN_TITLE_WIDTH = 20;
const MIN_YEAR_WIDTH = 4;
const MIN_STATUS_WIDTH = 8;

export const EMPTY_MESSAGE =
  'No citations found. Import some with: citation-needed import-bibtex <file>';

function computeWidths(terminalWidth: number): ColumnWidths {
  const availableWidth = Math.max(terminalWidth - GUTTER_WIDTH, 0);
  const widths: ColumnWidths = {
    doi: PREFERRED_DOI_WIDTH,
    year: PREFERRED_YEAR_WIDTH,
    status: PREFERRED_STATUS_WIDTH,
    title: Math.max(
      availableWidth - PREFERRED_DOI_WIDTH - PREFERRED_YEAR_WIDTH - PREFERRED_STATUS_WIDTH,
      MIN_TITLE_WIDTH
    ),
  };

  return shrinkToFit(widths, availableWidth, [
    ['doi', MIN_DOI_WIDTH],
    ['status', MIN_STATUS_WIDTH],
    ['year', MIN_YEAR_WIDTH],
    ['title', MIN_TITLE_WIDTH],
    ['doi', 0],
    ['status', 0],
    ['year', 0],
    ['title', 0],
  ]);
}

function shrinkToFit(
  widths: ColumnWidths,
  availableWidth: number,
  shrinkSteps: Array<[keyof ColumnWidths, number]>
): ColumnWidths {
  const nextWidths = { ...widths };

  for (const [key, minimumWidth] of shrinkSteps) {
    const overflow = totalWidth(nextWidths) - availableWidth;
    if (overflow <= 0) {
      return nextWidths;
    }

    const shrinkBy = Math.min(Math.max(nextWidths[key] - minimumWidth, 0), overflow);
    nextWidths[key] -= shrinkBy;
  }

  return nextWidths;
}

function totalWidth(widths: ColumnWidths): number {
  return widths.doi + widths.title + widths.year + widths.status;
}

function fitCell(value: string, width: number): string {
  if (width <= 0) {
    return '';
  }

  return truncate(value, Math.max(width - 1, 0)).padEnd(width);
}

function truncate(value: string, maxLen: number): string {
  const safeMaxLen = Math.max(maxLen, 0);
  if (safeMaxLen === 0) {
    return '';
  }

  return value.length > safeMaxLen ? value.slice(0, safeMaxLen) : value;
}

function statusColor(status: string): Style {
  switch (status) {
    case 'verified':
    case 'downloaded':
      return 'green';
    case 'failed':
    case 'not-found':
      return 'red';
    case 'unverified':
      return 'yellow';
    default:
      return 'gray';
  }
}

/**
 * Render the citations table to plain lines. Column widths are computed here
 * rather than delegated to a layout engine, which is why this never needed to
 * be a React component: padding is applied before colour so the ANSI escapes
 * never count toward cell width.
 */
export function formatCitationsTable(
  rows: CitationRow[],
  terminalWidth: number = process.stdout.columns ?? DEFAULT_TERMINAL_WIDTH
): string[] {
  if (rows.length === 0) {
    return [paint(EMPTY_MESSAGE, 'yellow')];
  }

  const widths = computeWidths(terminalWidth);
  const header = paint(
    fitCell('DOI', widths.doi) +
      fitCell('Title', widths.title) +
      fitCell('Year', widths.year) +
      fitCell('Status', widths.status),
    'bold'
  );

  const body = rows.map(
    (row) =>
      fitCell(row.doi || '', widths.doi) +
      fitCell(row.title || '(no title)', widths.title) +
      fitCell(String(row.year || ''), widths.year) +
      paint(fitCell(row.verificationStatus, widths.status), statusColor(row.verificationStatus))
  );

  return [header, ...body];
}
