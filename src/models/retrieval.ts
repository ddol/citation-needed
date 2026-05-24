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
}

/**
 * Discriminated result returned from external-API resolvers (arXiv, Unpaywall,
 * DOI/Crossref). Distinguishes "no result for this query" (`ok: true, value:
 * null/[]`) from "the request itself failed" (`ok: false`) so callers can
 * surface real failures instead of silently treating them as misses.
 */
export type ResolverResult<T> = { ok: true; value: T } | { ok: false; error: string };
