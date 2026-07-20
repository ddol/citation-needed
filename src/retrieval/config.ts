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

/**
 * Semantic Scholar's unauthenticated pool is shared across all callers, so it
 * throttles hard: a 56-DOI survey at 3s intervals saw zero 429s, while 1s
 * intervals got throttled off the API within a handful of requests. An API key
 * would buy a guaranteed quota; until then, pace conservatively.
 */
export const SEMANTIC_SCHOLAR_RATE_LIMIT_MS = 3_000;
export const SEMANTIC_SCHOLAR_TIMEOUT_MS = 20_000;
export const SEMANTIC_SCHOLAR_MAX_ATTEMPTS = 4;
export const SEMANTIC_SCHOLAR_RETRY_BASE_MS = 3_000;

/**
 * Consecutive throttled lookups before the resolver stops calling Semantic
 * Scholar. The shared pool refuses in streaks, not one DOI at a time, so past
 * this point every further attempt is load we add to a throttle we are already
 * inside.
 */
export const SEMANTIC_SCHOLAR_THROTTLE_TRIP = 3;

/**
 * How long the breaker stays open before letting one probe through.
 *
 * Throttling is a passing streak, not a property of the run: treating it as
 * permanent cost a 56-entry import every paper only Semantic Scholar has. Wait
 * out the streak, then try again rather than writing the source off.
 */
export const SEMANTIC_SCHOLAR_BREAKER_COOLDOWN_MS = 30_000;

/**
 * Pause before an import retries the DOIs a rate limit refused. Long enough for
 * a throttle window to lapse; the alternative is losing those citations for the
 * whole run, since a throttled DOI was never actually looked up.
 */
export const THROTTLE_COOLDOWN_MS = 60_000;

/** PDF download HTTP timeout (open-access downloader). */
export const OPEN_ACCESS_DOWNLOAD_TIMEOUT_MS = 60_000;

/** Fallback contact email if no auth config / env var is set. */
export const DEFAULT_CONTACT_EMAIL = 'citation-needed@example.com';
