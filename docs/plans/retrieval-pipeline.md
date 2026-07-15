# Retrieval Pipeline & Cascade Hygiene

| Field         | Value                                                                   |
| ------------- | ----------------------------------------------------------------------- |
| Status        | **Core — slice 3** (cascade trims; adapter implementations exploratory) |
| Work-stream   | C — Coverage & Acquisition                                              |
| Depends on    | —                                                                       |
| Last reviewed | 2026-07-14                                                              |

## Intent

Every stage in the retrieval cascade either resolves real PDFs or is not in
the loop. Capability that exists in code but cannot yet succeed is **parked**
— unexported, unwired, covered by its unit tests — instead of being exercised
on every miss. This doc owns the cascade's shape and hosts the parked
acquisition work until each piece earns its slot back.

## Current state

- `RetrievalOrchestrator.retrievePdf` (`src/retrieval/index.ts:39`) runs
  cache → Unpaywall → arXiv → publisher → authenticated, accumulating a
  one-line `attempts` summary into `RetrievalResult.message`.
- The publisher stage can never succeed: `getAdapter` matches DOI prefixes
  (10.1007 Springer, 10.1016 Elsevier, 10.1145 ACM —
  `src/retrieval/publishers/`) but no adapter implements `getPdfUrl`, so every
  cache-miss appends `publisher(<name>: no direct PDF URL)` and moves on —
  noise in every failure message, no capability.
- `DoiResolver` (Crossref metadata lookup, `src/retrieval/resolvers/doi.ts`)
  is re-exported from both barrel files (`src/retrieval/index.ts`,
  `src/retrieval/resolvers/index.ts`) but wired into nothing — only its tests
  call it. Exported, it reads as supported functionality; it is a helper
  awaiting the Crossref metadata-enrichment item.
- No retry/backoff on failed downloads; only `proxies[0]` of the configured
  institutional proxies is used.

## Design

### Cascade trim (core, slice 3)

The active cascade is **cache → Unpaywall → arXiv → authenticated**.
`tryPublisher` and its orchestrator call site are deleted; the adapter files
and their URL-helper tests stay as scaffolding for the Flow C implementation
items. The existing "Wire publisher adapters into RetrievalOrchestrator
fallback chain" item is the explicit re-entry gate: a stage joins the cascade
only when its resolver produces real, test-backed PDF URLs (behind auth
config where required).

### DoiResolver parking (core, slice 3)

`DoiResolver` drops out of both public barrel exports; the class and its tests
stay in place. It returns as the engine of the Crossref metadata-enrichment
item (abstract, keywords, licence, ISSN — which also populates the
currently-always-undefined `isOpenAccess`).

### Future cascade entries (exploratory, unchanged)

Publisher adapters (Springer, Elsevier, ACM), PubMed/NCBI E-utilities,
graph-source open-access URLs ([citation-graph.md](citation-graph.md)),
exponential backoff on failed downloads, publisher API key management, and
proxy rotation all remain parked Flow C items. Each lands behind the same
gate: a resolver that produces a real PDF URL, plus one cascade integration
test per re-entered stage.

### Rejected / deferred alternatives

- **Experimental flag for the publisher stage**: there is nothing to
  experiment with until an adapter returns URLs; a flag hides the dead branch
  instead of removing it.
- **Deleting the adapter code and tests**: the prefix matching and URL helpers
  are the scaffolding the three L implementation items build on — cheap to
  keep, already tested.
- **A resolver plugin registry**: three call sites read better than a
  registry; revisit if the cascade grows past ~6 stages.

## Phasing

1. **Slice 3 trims**: remove `tryPublisher` from the cascade; unexport
   `DoiResolver`; update orchestrator cascade tests and failure-message
   expectations.
2. **Per adapter (exploratory)**: implement PDF resolution → wire the stage
   back → extend auth config as needed.

## Backlog items

Core — slice 3:

- [fetch] S - Drop tryPublisher from the active retrieval cascade; adapters and their tests stay as parked scaffolding (see docs/plans/retrieval-pipeline.md)
- [fetch] XS - Unexport DoiResolver from the retrieval barrels until Crossref enrichment schedules it (see docs/plans/retrieval-pipeline.md)

Exploratory (Flow C, parked here):

- [fetch] L - Implement Springer Link PDF resolution via publisher adapter
- [fetch] L - Implement Elsevier ScienceDirect PDF resolution via publisher adapter
- [fetch] L - Implement ACM Digital Library PDF resolution via publisher adapter
- [fetch] L - PubMed/NCBI E-utilities resolver for life-sciences papers
- [fetch] M - Wire publisher adapters into RetrievalOrchestrator fallback chain
- [fetch] M - Exponential backoff retry for failed HTTP download attempts
- [fetch] M - Metadata enrichment from Crossref: abstract, keywords, licence, ISSN
- [fetch] S - DoiResolver: populate isOpenAccess field
- [auth] M - API key management for publisher APIs (Elsevier, Springer)
- [auth] M - Proxy rotation across multiple configured institutional proxies

## Testing

- Orchestrator cascade tests assert the publisher stage is absent: a
  Springer-prefix DOI miss goes Unpaywall → arXiv → authenticated with no
  publisher attempt line in the message.
- `attempts` message shape stays covered — a readable failure trail is a
  feature, not incidental output.
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

- [citation-graph.md](citation-graph.md) — graph-source open-access PDF URLs
  join the cascade behind the same re-entry gate.
- [local-bibliography-spider.md](local-bibliography-spider.md) — uses the
  shared Crossref enrichment path for parsed references but remains
  metadata-only and never downloads PDFs.
- [service-layer.md](service-layer.md) — its RetrievalService phase wraps the
  orchestrator; this doc owns the cascade shape it wraps.
- [storage-adapters.md](storage-adapters.md) — its HTTPS re-fetch open
  question defers to this cascade for re-downloads.
