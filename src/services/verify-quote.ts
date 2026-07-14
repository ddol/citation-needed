import fs from 'fs';
import type { Database } from '../db/index';
import type { VerifyQuoteMatch, VerifyQuoteRequest, VerifyQuoteResponse } from './contracts';
import { resolveMarkdownPath } from './markdown-locator';

const MIN_QUOTE_LENGTH = 10;
const SNIPPET_RADIUS = 150;
const MAX_MATCHES = 5;

export type VerifyQuoteResult =
  | { status: 'ok'; response: VerifyQuoteResponse }
  | { status: 'unknown-doi' }
  | { status: 'no-markdown' }
  | { status: 'quote-too-short' };

/**
 * Fold the differences PDF extraction introduces so a faithfully quoted
 * passage matches its source text exactly:
 * NFKC (folds ligatures like ﬁ) → strip soft hyphens → re-join words split by
 * line-break hyphenation → fold curly quotes and unicode dashes to ASCII →
 * collapse whitespace runs → lowercase.
 *
 * Both the quote and the document text pass through this, so a match means
 * "verbatim up to typography".
 */
export function normalizeForMatch(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/\u00AD/g, '')
    .replace(/-[ \t]*\n\s*/g, '')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * verify-quote v1: exact match after normalization, against one citation's
 * extracted Markdown or the whole corpus. The FTS fuzzy fallback with section
 * provenance ('close-match') arrives in core slice 2.
 */
export class VerifyQuoteService {
  constructor(private readonly db: Database) {}

  verify(request: VerifyQuoteRequest): VerifyQuoteResult {
    const needle = normalizeForMatch(request.quote);
    if (needle.length < MIN_QUOTE_LENGTH) return { status: 'quote-too-short' };

    if (request.doi) {
      const citation = this.db.getCitation(request.doi);
      if (!citation) return { status: 'unknown-doi' };

      const markdownPath = resolveMarkdownPath(citation);
      if (!markdownPath) return { status: 'no-markdown' };

      const match = findInFile(citation.doi, markdownPath, needle);
      return {
        status: 'ok',
        response: { verdict: match ? 'exact' : 'not-found', matches: match ? [match] : [] },
      };
    }

    const matches: VerifyQuoteMatch[] = [];
    for (const citation of this.db.getAllCitations()) {
      if (matches.length >= MAX_MATCHES) break;

      const markdownPath = resolveMarkdownPath(citation);
      if (!markdownPath) continue;

      const match = findInFile(citation.doi, markdownPath, needle);
      if (match) matches.push(match);
    }

    return {
      status: 'ok',
      response: { verdict: matches.length > 0 ? 'exact' : 'not-found', matches },
    };
  }
}

function findInFile(doi: string, markdownPath: string, needle: string): VerifyQuoteMatch | null {
  const haystack = normalizeForMatch(fs.readFileSync(markdownPath, 'utf-8'));
  const index = haystack.indexOf(needle);
  if (index === -1) return null;

  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(haystack.length, index + needle.length + SNIPPET_RADIUS);
  const snippet = `${start > 0 ? '…' : ''}${haystack.slice(start, end)}${
    end < haystack.length ? '…' : ''
  }`;

  return { doi, similarity: 1, snippet };
}
