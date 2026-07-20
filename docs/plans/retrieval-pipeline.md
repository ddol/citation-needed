# Retrieval pipeline & cascade hygiene

| Field      | Value                                                                  |
| ---------- | ---------------------------------------------------------------------- |
| Status     | **Core: slice 3** (cascade trims; adapter implementations exploratory) |
| Flow       | C                                                                      |
| Depends on | None                                                                   |

## Intent

Every stage in the retrieval cascade either resolves real PDFs or is not in
the loop. Capability that exists in code but cannot yet succeed is **parked**
(unexported, unwired, covered by its unit tests) instead of being exercised
on every miss. This doc owns the cascade's shape and hosts the parked
acquisition work until each piece earns its slot back.

## Current state

- `RetrievalOrchestrator.retrievePdf` (`src/retrieval/index.ts`) runs
  cache → Unpaywall → Semantic Scholar → arXiv → publisher → authenticated,
  accumulating a one-line `attempts` summary into `RetrievalResult.message`.
  DOI-keyed sources run before the arXiv title search.
- Identity is checked before every download via `src/retrieval/title-match.ts`,
  at two thresholds: strict for title search (arXiv), loose for DOI lookups,
  where the DOI already proves identity and the title only guards against wrong
  upstream metadata.
- Lookups retry through `src/retrieval/http-retry.ts` (`Retry-After`, else
  exponential; 429 and 5xx). Per-host limits live in `src/retrieval/config.ts`.
- The publisher stage can never succeed: `getAdapter` matches DOI prefixes
  (10.1007 Springer, 10.1016 Elsevier, 10.1145 ACM, in
  `src/retrieval/publishers/`) but no adapter implements `getPdfUrl`, so every
  cache-miss appends `publisher(<name>: no direct PDF URL)` and moves on:
  noise in every failure message, no capability.
- `DoiResolver` (Crossref metadata lookup, `src/retrieval/resolvers/doi.ts`)
  is re-exported from both barrel files (`src/retrieval/index.ts`,
  `src/retrieval/resolvers/index.ts`) but wired into nothing; only its tests
  call it. Exported, it reads as supported functionality; it is a helper
  awaiting the Crossref metadata-enrichment item.
- Retry/backoff covers _lookups_, not the PDF `GET` itself; only `proxies[0]` of
  the configured institutional proxies is used.
- A resolved URL is not always a fetchable one. Publisher-hosted PDFs answer 403
  (MDPI, ACM) and some repository hosts serve incomplete certificate chains
  (`unable to verify the first certificate`). The 403 is **not** a User-Agent
  block (a browser UA and no UA are refused identically), so there is nothing to
  fix here without misrepresenting who we are, which
  [TENETS.md](../../TENETS.md) § Legitimate access only forbids.
- Semantic Scholar's unauthenticated pool throttles in streaks.
  `SemanticScholarResolver` trips a breaker after
  `SEMANTIC_SCHOLAR_THROTTLE_TRIP` consecutive 429s, pauses lookups for
  `SEMANTIC_SCHOLAR_BREAKER_COOLDOWN_MS`, then lets one probe through and closes
  if it lands. `SEMANTIC_SCHOLAR_API_KEY` restores the full retry budget and
  makes the whole path rare.
- Throttled DOIs are recovered rather than written off: `RetrievalResult.throttled`
  marks a DOI that was refused before it was looked up, and `processBibtexFile`
  queues those, waits `THROTTLE_COOLDOWN_MS`, clears the breaker via
  `retriever.resetTransientState()`, and retries the queue exactly once.

## Design

### Cascade trim (core, slice 3)

The cascade should be **cache → Unpaywall → Semantic Scholar → arXiv →
authenticated**. `tryPublisher` and its orchestrator call site are deleted; the
adapter files and their URL-helper tests stay as scaffolding for the Flow C
implementation items. The existing "Wire publisher adapters into
RetrievalOrchestrator fallback chain" item is the explicit re-entry gate: a stage
joins the cascade only when its resolver produces real, test-backed PDF URLs
(behind auth config where required).

### DoiResolver parking (core, slice 3)

`DoiResolver` drops out of both public barrel exports; the class and its tests
stay in place. It returns as the engine of the Crossref metadata-enrichment
item (abstract, keywords, licence, ISSN, which also populates the
currently-always-undefined `isOpenAccess`).

### Coverage ceiling

Open-access sources are complementary, not redundant, and they run out. Measured
against a 56-entry robotics/LiDAR bibliography: Unpaywall and arXiv together
reach 21; adding Semantic Scholar reaches 26. The remaining ~30 are paywalled
IEEE/Elsevier/ACM papers with no free copy anywhere, so **~46% is the ceiling
without institutional access**: past that is the `authenticated` stage, not
another aggregator.

### Future cascade entries (exploratory)

Publisher adapters (Springer, Elsevier, ACM), PubMed/NCBI E-utilities,
graph-source open-access URLs ([citation-graph.md](citation-graph.md)),
publisher API key management, and proxy rotation all remain parked Flow C items.
Each lands behind the same gate: a resolver that produces a real PDF URL, plus
one cascade integration test per re-entered stage.

### Rejected / deferred alternatives

- **OpenAlex as a fourth open-access source**: measured against the same
  56-entry bibliography it resolved 13 papers and added **zero** the existing
  sources did not already cover. It is a third upstream to maintain for no new
  PDFs. Revisit only as redundancy if Semantic Scholar's throttling proves
  intolerable; and note OpenAlex has required API keys since Feb 2026.
- **Experimental flag for the publisher stage**: there is nothing to
  experiment with until an adapter returns URLs; a flag hides the dead branch
  instead of removing it.
- **Deleting the adapter code and tests**: the prefix matching and URL helpers
  are the scaffolding the three L implementation items build on: cheap to
  keep, already tested.
- **A resolver plugin registry**: a handful of call sites read better than a
  registry; revisit if the cascade grows past ~6 stages.

## Phasing

1. **Slice 3 trims**: remove `tryPublisher` from the cascade; unexport
   `DoiResolver`; update orchestrator cascade tests and failure-message
   expectations.
2. **Per adapter (exploratory)**: implement PDF resolution → wire the stage
   back → extend auth config as needed.

## Backlog items

Core slice 3:

- [fetch] S - Drop tryPublisher from the active retrieval cascade; adapters and their tests stay as parked scaffolding (see docs/plans/retrieval-pipeline.md)
- [fetch] XS - Unexport DoiResolver from the retrieval barrels until Crossref enrichment schedules it (see docs/plans/retrieval-pipeline.md)

Exploratory (Flow C, parked here):

- [fetch] L - Implement Springer Link PDF resolution via publisher adapter
- [fetch] L - Implement Elsevier ScienceDirect PDF resolution via publisher adapter
- [fetch] L - Implement ACM Digital Library PDF resolution via publisher adapter
- [fetch] L - PubMed/NCBI E-utilities resolver for life-sciences papers
- [fetch] M - Wire publisher adapters into RetrievalOrchestrator fallback chain
- [fetch] M - Extend the shared http-retry backoff to the PDF GET itself; today it covers lookups only
- [fetch] M - Publisher-hosted PDFs 403 on our User-Agent (MDPI confirmed): decide whether to send a browser-like UA, fall through to the next source, or record the URL for manual fetch
- [fetch] M - Resumable retry queue: the cooldown pass is in-process, so a run killed mid-import loses its throttled queue. Persisting it would let a later run pick the DOIs up
- [fetch] M - Metadata enrichment from Crossref: abstract, keywords, licence, ISSN
- [fetch] S - DoiResolver: populate isOpenAccess field
- [auth] M - API key management for publisher APIs (Elsevier, Springer)
- [auth] M - Proxy rotation across multiple configured institutional proxies

## Testing

- Orchestrator cascade tests assert stage order and that the publisher stage is
  absent: a Springer-prefix DOI miss goes Unpaywall → Semantic Scholar → arXiv →
  authenticated with no publisher attempt line in the message.
- A DOI source answering means the arXiv title search never runs.
- Identity guards are covered per source: a title-search near-miss is rejected, a
  DOI lookup whose upstream title is grossly wrong is rejected, and a DOI lookup
  whose title is merely abbreviated is accepted.
- Throttling is covered as its own failure mode: a 429 retries and can still
  succeed, and an exhausted budget surfaces an error rather than an empty result.
- `attempts` message shape stays covered: a readable failure trail is a
  feature, not incidental output.
- Network is mocked; per-host pacing is collapsed via the config module so retry
  tests do not sleep.
- Re-wiring (future, per adapter): fixture tests for URL resolution plus one
  cascade integration test for the re-entered stage.

## Open questions

1. Crossref enrichment is needed both for general citation metadata and for
   parsed bibliography references
   ([local-bibliography-spider.md](local-bibliography-spider.md)). Implement it
   once, with recorded fixtures and provenance, rather than adding separate
   fetchers.
2. SAML/Shibboleth remains backlog-only. Before scheduling, decide whether it
   belongs in the authenticated downloader, an external browser-profile setup
   guide, or a separate institutional-access plan.

## Relationship to other plans

- [citation-graph.md](citation-graph.md): graph-source open-access PDF URLs
  join the cascade behind the same re-entry gate. Its exploratory `GraphSource`
  Semantic Scholar client must reuse the retrieval resolver this doc owns
  (`src/retrieval/resolvers/semantic-scholar.ts`) rather than add a second S2
  client and a second rate limiter against the same shared pool.
- [local-bibliography-spider.md](local-bibliography-spider.md): uses the
  shared Crossref enrichment path for parsed references but remains
  metadata-only and never downloads PDFs.
- [service-layer.md](service-layer.md): its RetrievalService phase wraps the
  orchestrator; this doc owns the cascade shape it wraps.
- [storage-adapters.md](storage-adapters.md): its HTTPS re-fetch open
  question defers to this cascade for re-downloads.
