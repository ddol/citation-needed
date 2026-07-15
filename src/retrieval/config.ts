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

/**
 * Rate limit between arXiv search calls. arXiv's terms ask for **one request
 * every three seconds**, not one per second. Running at 2s got a 56-entry
 * import 429-ed on 36 of 54 lookups, which surfaced as "no PDF found" rather
 * than as the throttling it actually was.
 */
export const ARXIV_RATE_LIMIT_MS = 3_000;

/** Total arXiv attempts per query, including the first, before giving up. */
export const ARXIV_MAX_ATTEMPTS = 4;

/** First backoff pause after a throttled/failed arXiv query; doubles per retry. */
export const ARXIV_RETRY_BASE_MS = 5_000;

/** PDF download HTTP timeout (open-access downloader). */
export const OPEN_ACCESS_DOWNLOAD_TIMEOUT_MS = 60_000;

/** Fallback contact email if no auth config / env var is set. */
export const DEFAULT_CONTACT_EMAIL = 'citation-needed@example.com';
