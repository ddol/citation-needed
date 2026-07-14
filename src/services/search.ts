import type { Citation } from '../models/citation';
import type { Database } from '../db/index';
import type { CitationSummary, SearchCitationsRequest, SearchResponse } from './contracts';

const MATCH_FIELDS = ['title', 'authors', 'journal', 'bibtexKey', 'doi'] as const;

/**
 * Transport-independent corpus search. Lexical mode over the extended
 * Database.searchCitations LIKE query; results are trimmed summaries plus
 * which fields matched — callers use get-citation for full detail.
 */
export class SearchService {
  constructor(private readonly db: Database) {}

  search(request: SearchCitationsRequest): SearchResponse {
    const { citations, nextCursor } = this.db.searchCitations(request.query, {
      cursor: request.cursor,
      limit: request.limit,
    });

    const needle = request.query.toLowerCase();
    const results = citations.map((citation) => ({
      citation: toSummary(citation),
      matchedFields: MATCH_FIELDS.filter((field) =>
        citation[field]?.toLowerCase().includes(needle)
      ),
    }));

    return { results, nextCursor };
  }
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
