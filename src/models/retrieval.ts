export interface RetrievalAttempt {
  id?: number;
  citationId: number;
  source: string; // 'arxiv' | 'unpaywall' | 'doi-resolver' | 'playwright' | 'direct'
  url?: string;
  success: boolean;
  errorMessage?: string;
  durationMs?: number;
  createdAt?: string;
}

export interface RetrievalResult {
  success: boolean;
  pdfUrl?: string;
  localPath?: string;
  source: string;
  message: string;
  /**
   * A source refused to answer because it was rate-limiting us, so this DOI was
   * never really tried. Distinct from "no source has this paper", which no
   * amount of waiting will change — the caller can retry only these.
   */
  throttled?: boolean;
}

/**
 * Discriminated result returned from external-API resolvers (arXiv, Unpaywall,
 * DOI/Crossref). Distinguishes "no result for this query" (`ok: true, value:
 * null/[]`) from "the request itself failed" (`ok: false`) so callers can
 * surface real failures instead of silently treating them as misses.
 */
export type ResolverResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; throttled?: boolean };
