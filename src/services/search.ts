import type { Citation } from '../models/citation';
import type { Database } from '../db/index';
import type { CitationSummary, SearchCitationsRequest, SearchResponse } from './contracts';
import { decodeOffsetCursor, encodeOffsetCursor } from './content';

const MATCH_FIELDS = ['title', 'authors', 'journal', 'bibtexKey', 'doi'] as const;

/**
 * Transport-independent corpus search. Lexical mode runs on the FTS5 index
 * (bm25 ranking, snippets, section provenance) when it exists, and falls back
 * to the LIKE query otherwise. Results are trimmed summaries plus which
 * fields matched — callers use get-citation for full detail.
 */
export class SearchService {
  constructor(private readonly db: Database) {}

  search(request: SearchCitationsRequest): SearchResponse {
    const ftsAvailable = typeof this.db.hasFtsIndex === 'function' && this.db.hasFtsIndex();
    // Cursors are mode-specific: FTS pages by offset, LIKE by (created_at, id).
    // A cursor that isn't an offset cursor belongs to a LIKE walk in progress.
    if (ftsAvailable && (!request.cursor || isOffsetCursor(request.cursor))) {
      return this.searchWithFts(request);
    }
    return this.searchWithLike(request);
  }

  private searchWithFts(request: SearchCitationsRequest): SearchResponse {
    const limit = Math.min(Math.max(request.limit ?? 50, 1), 200);
    // bm25 ordering has no stable natural cursor, so FTS pages by offset.
    const offset = request.cursor ? decodeOffsetCursor(request.cursor) : 0;
    const { results, hasMore } = this.db.searchFts(request.query, { limit, offset });

    // FTS matches whole tokens; substring queries (partial keys, DOI
    // fragments) can legitimately miss. Rescue the first page via LIKE.
    if (results.length === 0 && offset === 0) {
      return this.searchWithLike(request);
    }

    const needle = request.query.toLowerCase();
    return {
      results: results.map(({ citation, matches }) => ({
        citation: toSummary(citation),
        matchedFields: matchedFields(citation, needle),
        matches: matches.length > 0 ? matches : undefined,
      })),
      nextCursor: hasMore ? encodeOffsetCursor(offset + limit) : undefined,
    };
  }

  private searchWithLike(request: SearchCitationsRequest): SearchResponse {
    const { citations, nextCursor } = this.db.searchCitations(request.query, {
      cursor: request.cursor,
      limit: request.limit,
    });

    const needle = request.query.toLowerCase();
    const results = citations.map((citation) => ({
      citation: toSummary(citation),
      matchedFields: matchedFields(citation, needle),
    }));

    return { results, nextCursor };
  }
}

function isOffsetCursor(cursor: string): boolean {
  try {
    decodeOffsetCursor(cursor);
    return true;
  } catch {
    return false;
  }
}

function matchedFields(citation: Citation, needle: string): string[] {
  const tokens = needle.trim().split(/\s+/).filter(Boolean);
  return MATCH_FIELDS.filter((field) => {
    const value = citation[field]?.toLowerCase();
    return value ? tokens.every((token) => value.includes(token)) : false;
  });
}

function toSummary(citation: Citation): CitationSummary {
  return {
    doi: citation.doi,
    title: citation.title,
    year: citation.year,
    journal: citation.journal,
    verificationStatus: citation.verificationStatus,
  };
}
