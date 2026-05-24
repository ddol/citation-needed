/**
 * Network and rate-limit constants for the retrieval layer.
 *
 * Keep these centralised so timeouts can be tuned per environment (CI,
 * integration tests) without hunting through resolvers and downloaders.
 */

/** HTTP request timeout for Unpaywall and Crossref/DOI lookups. */
export const RESOLVER_TIMEOUT_MS = 15_000;

/** arXiv Atom API can be slow; give it more headroom. */
export const ARXIV_TIMEOUT_MS = 30_000;

/** Rate limit between PDF downloads (Unpaywall / arXiv mirrors). */
export const OPEN_ACCESS_RATE_LIMIT_MS = 1_000;

/** Rate limit between arXiv search calls — arXiv asks for ~1 request/second. */
export const ARXIV_RATE_LIMIT_MS = 2_000;

/** PDF download HTTP timeout (open-access downloader). */
export const OPEN_ACCESS_DOWNLOAD_TIMEOUT_MS = 60_000;

/** Fallback contact email if no auth config / env var is set. */
export const DEFAULT_CONTACT_EMAIL = 'citation-needed@example.com';
