import fs from 'fs';
import type { ChunkRecord, Database } from '../db/index';
import type { VerifyQuoteMatch, VerifyQuoteRequest, VerifyQuoteResponse } from './contracts';
import { resolveMarkdownPath } from './markdown-locator';

const MIN_QUOTE_LENGTH = 10;
const SNIPPET_RADIUS = 150;
const MAX_MATCHES = 5;
const CLOSE_MATCH_THRESHOLD = 0.8;
const CANDIDATE_TOKEN_MIN_LENGTH = 4;
const CANDIDATE_TOKEN_LIMIT = 8;

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
 * verify-quote v2: exact match after normalization (with section provenance
 * from the chunk index when available), then an FTS-backed fuzzy fallback
 * that reports 'close-match' with token-overlap similarity — catching minor
 * misquotes and extraction drift.
 */
export class VerifyQuoteService {
  constructor(private readonly db: Database) {}

  verify(request: VerifyQuoteRequest): VerifyQuoteResult {
    const needle = normalizeForMatch(request.quote);
    if (needle.length < MIN_QUOTE_LENGTH) return { status: 'quote-too-short' };

    if (request.doi) return this.verifySingle(request.doi, needle);
    return this.verifyCorpus(needle);
  }

  private verifySingle(doi: string, needle: string): VerifyQuoteResult {
    const citation = this.db.getCitation(doi);
    if (!citation || citation.id == null) return { status: 'unknown-doi' };

    const markdownPath = resolveMarkdownPath(citation);
    const chunks = this.db.getChunksForCitation(citation.id);
    if (!markdownPath && chunks.length === 0) return { status: 'no-markdown' };

    const exact = markdownPath
      ? findExactInText(citation.doi, fs.readFileSync(markdownPath, 'utf-8'), needle, chunks)
      : findExactInChunks(citation.doi, chunks, needle);
    if (exact) {
      return { status: 'ok', response: { verdict: 'exact', matches: [exact] } };
    }

    const close = this.findCloseMatches(needle, doi);
    return {
      status: 'ok',
      response: {
        verdict: close.length > 0 ? 'close-match' : 'not-found',
        matches: close,
      },
    };
  }

  private verifyCorpus(needle: string): VerifyQuoteResult {
    const matches: VerifyQuoteMatch[] = [];
    for (const citation of this.db.getAllCitations()) {
      if (matches.length >= MAX_MATCHES) break;
      if (citation.id == null) continue;

      const markdownPath = resolveMarkdownPath(citation);
      if (!markdownPath) continue;

      const chunks = this.db.getChunksForCitation(citation.id);
      const match = findExactInText(
        citation.doi,
        fs.readFileSync(markdownPath, 'utf-8'),
        needle,
        chunks
      );
      if (match) matches.push(match);
    }

    if (matches.length > 0) {
      return { status: 'ok', response: { verdict: 'exact', matches } };
    }

    const close = this.findCloseMatches(needle);
    return {
      status: 'ok',
      response: {
        verdict: close.length > 0 ? 'close-match' : 'not-found',
        matches: close,
      },
    };
  }

  /** FTS-backed fuzzy fallback: OR the distinctive quote tokens, rank by
   *  bm25, then score candidates by token overlap with the quote. */
  private findCloseMatches(needle: string, doi?: string): VerifyQuoteMatch[] {
    if (typeof this.db.hasFtsIndex !== 'function' || !this.db.hasFtsIndex()) return [];

    const query = candidateQuery(needle);
    if (!query) return [];

    const tokenize = (text: string): string[] =>
      text
        .split(/\s+/)
        .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
        .filter((token) => token.length > 0);

    const needleTokens = new Set(tokenize(needle));
    return this.db
      .searchChunkCandidates(query, { doi, limit: MAX_MATCHES * 2 })
      .map((candidate) => {
        const normalized = normalizeForMatch(candidate.text);
        const candidateTokens = new Set(tokenize(normalized));
        let present = 0;
        for (const token of needleTokens) {
          if (candidateTokens.has(token)) present += 1;
        }
        const similarity = Math.round((present / needleTokens.size) * 100) / 100;
        return {
          doi: candidate.doi,
          similarity,
          snippet: excerpt(normalized),
          sectionPath: candidate.sectionPath,
          chunkOrdinal: candidate.ordinal,
        };
      })
      .filter((match) => match.similarity >= CLOSE_MATCH_THRESHOLD && match.similarity < 1)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, MAX_MATCHES);
  }
}

/** OR-query over the quote's distinctive tokens (AND would let one misquoted
 *  word hide every candidate). */
function candidateQuery(needle: string): string | null {
  const tokens = Array.from(
    new Set(needle.split(' ').filter((token) => token.length >= CANDIDATE_TOKEN_MIN_LENGTH))
  ).slice(0, CANDIDATE_TOKEN_LIMIT);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token.replace(/"/g, '')}"`).join(' OR ');
}

function findExactInText(
  doi: string,
  text: string,
  needle: string,
  chunks: ChunkRecord[]
): VerifyQuoteMatch | null {
  const haystack = normalizeForMatch(text);
  const index = haystack.indexOf(needle);
  if (index === -1) return null;

  const match: VerifyQuoteMatch = {
    doi,
    similarity: 1,
    snippet: snippetAround(haystack, index, needle.length),
  };

  // Best-effort provenance: the containing chunk, when the quote does not
  // straddle a chunk boundary.
  const within = chunks.find((chunk) => normalizeForMatch(chunk.text).includes(needle));
  if (within) {
    match.sectionPath = within.sectionPath;
    match.chunkOrdinal = within.ordinal;
  }
  return match;
}

function findExactInChunks(
  doi: string,
  chunks: ChunkRecord[],
  needle: string
): VerifyQuoteMatch | null {
  for (const chunk of chunks) {
    const haystack = normalizeForMatch(chunk.text);
    const index = haystack.indexOf(needle);
    if (index !== -1) {
      return {
        doi,
        similarity: 1,
        snippet: snippetAround(haystack, index, needle.length),
        sectionPath: chunk.sectionPath,
        chunkOrdinal: chunk.ordinal,
      };
    }
  }
  return null;
}

function snippetAround(haystack: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(haystack.length, index + matchLength + SNIPPET_RADIUS);
  return `${start > 0 ? '…' : ''}${haystack.slice(start, end)}${end < haystack.length ? '…' : ''}`;
}

function excerpt(normalized: string): string {
  if (normalized.length <= SNIPPET_RADIUS * 2) return normalized;
  return `${normalized.slice(0, SNIPPET_RADIUS * 2)}…`;
}
