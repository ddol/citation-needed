import type { Citation } from '../db/index';

// bibtex-parse uses CommonJS exports
const bibtexParse = require('bibtex-parse');

export interface ParsedCitation extends Omit<Citation, 'id'> {
  rawBibtex?: string;
}

export function parseBibtex(bibtexString: string): ParsedCitation[] {
  let entries: Record<string, unknown>[];
  try {
    entries = bibtexParse.entries(bibtexString) as Record<string, unknown>[];
  } catch {
    return [];
  }

  return entries.map((entry) => {
    // bibtex-parse v2: fields are UPPERCASE top-level properties
    const getField = (key: string): string | undefined => {
      const val = entry[key.toUpperCase()];
      if (val == null) return undefined;
      const str = String(val).trim();
      return str || undefined;
    };

    const yearStr = getField('year');
    const year = yearStr ? parseInt(yearStr, 10) : undefined;

    return {
      doi: getField('doi') || '',
      url: getField('url'),
      title: getField('title'),
      authors: getField('author') || getField('authors'),
      year: isNaN(year as number) ? undefined : year,
      journal:
        getField('journal') ||
        getField('booktitle') ||
        getField('publisher'),
      bibtexKey: entry['key'] as string | undefined,
      rawBibtex: bibtexString,
    } satisfies ParsedCitation;
  });
}
