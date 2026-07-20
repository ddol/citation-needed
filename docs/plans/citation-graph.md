# Citation graph, corpus expansion & discovery

| Field      | Value                                                                                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status     | **Exploratory** — interim: compose a community Semantic Scholar/OpenAlex MCP server alongside citation-needed                                                                                      |
| Flow       | C (discovery MCP tools: A; reference cross-check: B)                                                                                                                                               |
| Depends on | [domain-model.md](domain-model.md) (migration runner; identifiers for dedupe), [indexing-jobs.md](indexing-jobs.md) (expansion job kinds), [service-layer.md](service-layer.md) (contract pattern) |

## Intent

Populate and maintain a citation graph so the MCP server becomes an informed
research assistant: read a paper's references, follow who cites it, surface
significant follow-on work and newer ideas, and expand the corpus by bounded
snowballing — with downloads flowing through the existing retrieval cascade.

The system is **core + satellites** — the agent is the shell composing small
tools — and the graph belongs **in the core** when built, because its value is
joins against corpus state (which papers are members, frontier promotion,
verification cross-checks). What stays outside: scheduling (cron/launchd),
trend digests (files a cron'd command writes), and any third-party scout tools
(they feed the corpus through the pipe contract: BibTeX/JSONL →
`citation-needed import`).

## Current state

- No graph storage, no edges, no discovery tools anywhere in the codebase.
- Reusable pieces: `RateLimiter` (`src/utils/rate-limiter.ts`), the retrieval
  cascade for frontier promotion, `INSERT OR IGNORE` upsert semantics, the
  planned jobs pipeline, and the planned identifiers table for cross-source
  dedupe. The reference-list-extraction item pairs with this plan as a
  cross-check source, not the primary edge source.
- External landscape (verified 2026-07): **Semantic Scholar** Academic Graph +
  Recommendations APIs — references/citations with `isInfluential`, recs from
  seed papers; free key ≈ 1 req/s, unauthenticated pool 5k req/5 min.
  **OpenAlex** — `referenced_works`, `cites:` filter, `related_works`, topics
  with per-year counts; **API keys required since Feb 2026** (polite pool
  retired), 100k calls/day free. Python snowballing tools (LitStudy,
  Paperfetcher, paperscraper) wrap these same APIs; Google Scholar scrapers are
  ToS-hostile; crawler frameworks duplicate what the jobs plan already provides.

## Design

### GraphSource interface, thin in-repo clients

Same adapter pattern as StorageAdapter; sources are config + key via env like
existing resolvers.

```ts
// src/graph/source.ts
interface GraphSource {
  readonly name: string; // 'semantic-scholar' | 'openalex'
  lookup(ref: PaperRef): Promise<GraphPaper | null>; // by DOI / arXiv id
  references(ref: PaperRef, cursor?: string): Promise<GraphEdgePage>; // backward
  citations(ref: PaperRef, cursor?: string): Promise<GraphEdgePage>; // forward
  related(seeds: PaperRef[], limit?: number): Promise<GraphPaper[]>; // recommendations
}
```

Client order: **Semantic Scholar first** (recommendations + influence signals
cover "newer ideas" and "significant follow-ons"), **OpenAlex second** (bulk
edge budget + topic trends). Both rate-limited via `RateLimiter`; responses
cached; every lookup writes edges (the graph accretes passively).

### Schema (via the migration runner)

```sql
CREATE TABLE citation_edges (
  citing_citation_id INTEGER NOT NULL REFERENCES citations(id) ON DELETE CASCADE,
  cited_citation_id  INTEGER NOT NULL REFERENCES citations(id) ON DELETE CASCADE,
  source TEXT NOT NULL, -- 'semantic-scholar' | 'openalex' | 'extracted'
  is_influential INTEGER, -- source signal, nullable
  discovered_at TEXT NOT NULL,
  PRIMARY KEY (citing_citation_id, cited_citation_id, source)
);
```

`citations` gains `corpus_status TEXT NOT NULL DEFAULT 'member' CHECK
(corpus_status IN ('member', 'frontier'))`. Frontier rows are metadata-only
stubs discovered through the graph; promotion to member = the existing
retrieval + extraction pipeline. Stubs require a DOI until DOI-less admission
lands. The identifiers table gains `semantic-scholar-id` / `openalex-id`
schemes for cross-source dedupe.

### Agent-facing MCP tools (Flow A)

- `get-references {doi}` — what this paper cites (backward).
- `get-citing-papers {doi, sort: influence | recency}` — follow-on work; the
  "significant papers since the one we're discussing" query.
- `related-papers {seeds[], limit}` — recommendations from the paper(s) under
  discussion.
- `check-corpus {dois[]}` — batch membership join: which of these do I already
  have (member / frontier / absent). The tool that makes external discovery
  results actionable against the local corpus.
- `expand-corpus {seeds?, direction, depth, budget, filters}` — enqueues
  bounded snowball jobs.

### Expansion & trends (Flow C)

- **Snowball job kind** in the jobs pipeline: explicit invocations only (MCP
  tool or CLI), depth ≤ 2 default, per-run API-call and new-stub budgets,
  year/field filters, dedupe via identifiers. No standing autonomous crawl.
- **Frontier promotion**: graph-source open-access PDF URLs join the retrieval
  cascade as an additional OA source (coverage win independent of the graph).
- **`trends` CLI command**: new works citing corpus members since the last run
  → writes a Markdown/JSON digest file for the agent (the webhook item can
  announce it). **Scheduling stays external** — a cron/launchd recipe in the
  composition docs, no scheduler inside citation-needed.

### Satellites & interop (pipe contract)

Any external scout (Paperfetcher, LitStudy, a shell script, a community
Semantic Scholar MCP server the agent also has mounted) composes with the core
through `citation-needed import` (BibTeX/JSONL in) and digest files out. The
SQLite DB is **not** a public API for siblings — read-only at most (rule
documented in the composition docs item).

### Rejected / deferred alternatives

- **External tool sidecar as the first GraphSource** (Python
  LitStudy/Paperfetcher bridge, Inciteful API): superseded by the
  core+satellites decomposition — the graph joins corpus state, and the clients
  are ~2 thin REST wrappers; an additional GraphSource backed by such a tool
  remains possible later.
- **A separate graph MCP server of our own**: joins against corpus state are
  the point; agents can still mount third-party graph servers alongside.
- **Google Scholar scraping** (scholarly/SerpAPI/PyPaperBot): ToS-hostile,
  fragile, or paid. Permanently rejected.
- **Generic crawler frameworks** (Scrapy/Crawlee): the queue they'd provide is
  the jobs plan; the graph is API data, not web pages.
- **Standing autonomous crawler**: explicit budgeted expansion plus
  cron-scheduled trends only.

## Phasing

1. **Read-only graph**: GraphSource + Semantic Scholar client;
   `citation_edges` + `corpus_status` migration; `get-references`,
   `get-citing-papers`, `related-papers`, `check-corpus` MCP tools; edges
   cached on lookup. Needs only the migration runner.
2. **Expansion**: `expand-corpus` snowball job kind + frontier promotion +
   OA-URL cascade source + OpenAlex client.
3. **Trends & cross-check**: `trends` digest command + cron recipe in the
   composition docs; extracted-reference cross-check (Flow B).

## Backlog items (all exploratory)

Phase 1:

- [fetch] M - GraphSource interface + Semantic Scholar client (references/citations with isInfluential, recommendations; rate-limited, cached) (see docs/plans/citation-graph.md)
- [db] M - citation_edges table + corpus_status (member|frontier) on citations via migration runner (see docs/plans/citation-graph.md)
- [mcp] M - MCP tools: get-references + get-citing-papers (sort by influence|recency); edges cached on lookup (see docs/plans/citation-graph.md)
- [mcp] S - MCP tool: related-papers — recommendations from seed paper(s) (see docs/plans/citation-graph.md)
- [mcp] S - MCP tool: check-corpus — batch DOI membership join: member|frontier|absent (see docs/plans/citation-graph.md)
- [test] S - GraphSource fixture tests: recorded API responses, edge idempotency, rate-limit respect

Phases 2–3:

- [fetch] M - OpenAlex GraphSource client (bulk edges via cites: filter, related_works, topics; API key required)
- [flow] M - expand-corpus: bounded snowball job kind (depth/budget/filters, frontier stubs, identifiers dedupe) + MCP/CLI trigger
- [fetch] S - Graph-source open-access PDF URLs as an additional retrieval-cascade source
- [cli] M - `trends` command: new works citing corpus members since last run → digest file; cron-scheduled, no in-core scheduler
- [verify] S - Cross-check extracted reference lists against graph edges; flag extraction/graph gaps
- [docs] S - docs/composition.md: satellite pipe contract (BibTeX/JSONL in via import, digest files out; SQLite is not a public API — read-only at most) + cron recipes for trends

## Testing

- Recorded-fixture tests per GraphSource (no live API in CI); contract test
  suite run against every source.
- Edge idempotency: same lookup twice ⇒ no duplicate edges; multi-source edges
  coexist under the composite key.
- Budget enforcement: expansion stops at depth/budget exactly; frontier stubs
  never trigger downloads without promotion.
- check-corpus join correctness across member/frontier/absent.
- trends digest: stable output for a fixed corpus + fixed API fixtures.

## Open questions

1. Frontier visibility in search: do frontier stubs appear in search-citations
   results (flagged) or only via check-corpus/expansion reports?
2. Edge staleness: refresh policy for cached citation counts / new-edge
   discovery on corpus members (piggyback on `trends` runs?).
3. Citation contexts (S2 provides quote snippets around citations): store them
   as edge metadata for the assistant, or fetch on demand?

## Ownership notes

- Extracted reference parsing and raw bibliography evidence are owned by
  [local-bibliography-spider.md](local-bibliography-spider.md). This plan owns
  external graph-source edges, frontier/member status, graph MCP tools, and
  cross-checking graph-source edges against accepted local reference evidence.
- Graph-source open-access URLs do not bypass the retrieval cascade; they enter
  through the stage re-entry gate in
  [retrieval-pipeline.md](retrieval-pipeline.md).

## Relationship to other plans

- [domain-model.md](domain-model.md) — migration runner hosts the edges/status
  migration; identifiers gains graph-source schemes; DOI-less admission lifts
  the stub-requires-DOI constraint.
- [local-bibliography-spider.md](local-bibliography-spider.md) — provides
  local extracted-reference evidence and accepted local citation edges for
  cross-checking.
- [indexing-jobs.md](indexing-jobs.md) — snowball/trends run as job kinds;
  scheduling stays external.
- [service-layer.md](service-layer.md) — graph tools follow the shared
  zod-contract pattern and appear in the operation mapping table.
- [zotero-integration.md](zotero-integration.md) — complementary: the graph is
  the discovery/acquisition channel; Zotero remains the curated-library
  workflow sync.
- [fts5-full-text-search.md](fts5-full-text-search.md) — independent; the
  extractor-filter evaluation recorded there pairs with the OCR/coverage story.
- [http-api.md](http-api.md) — graph endpoints are deferred HTTP bindings of
  the same services if a non-MCP client ever needs them.
