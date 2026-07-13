# Plans

Forward-looking plan documents for evolving citation-needed from a BibTeX →
PDF/Markdown retrieval sidecar into the local **search, indexing, and
document-resolution layer** for an academic corpus. It explicitly does **not**
replace Zotero's UI, PDF reader, or citation tooling, nor file servers or existing
directory structures. The search core stays deterministic (LLM features live
outside it), SQLite stays until benchmarks object, and there is **one operation
vocabulary in a single service layer — bound to MCP first, with CLI/HTTP as future
thin gateways — never per-surface APIs**.

These plans capture and correct an external exploration doc (referenced throughout
as "source exploration"); every Current-state claim here was verified against this
repository.

## Target boundary

```
  BibTeX files · Zotero exports · arXiv / Unpaywall / Crossref · publisher PDFs
        │
        ▼
  citation-needed  (ingest → resolve → download → extract → chunk → index)
        │
        ▼
  SQLite: citations · retrieval_log · manifestations · identifiers · chunks · FTS5 · [vectors]
        │
        ▼
  MCP (stdio, today) · CLI · HTTP /api/v1 (future) · zotero:// links
```

## Plan status

| Plan                                                 | Status            | Milestone(s)    | Depends on                  |
| ---------------------------------------------------- | ----------------- | --------------- | --------------------------- |
| [service-layer.md](service-layer.md)                 | Adopted           | M3              | —                           |
| [domain-model.md](domain-model.md)                   | Adopted           | M3 / M5 / M6    | —                           |
| [fts5-full-text-search.md](fts5-full-text-search.md) | Adopted           | M3 (+ M4 bench) | service-layer, domain-model |
| [indexing-jobs.md](indexing-jobs.md)                 | Adopted           | M4              | domain-model, fts5          |
| [http-api.md](http-api.md)                           | Adopted           | M5              | service-layer (fts5 soft)   |
| [zotero-integration.md](zotero-integration.md)       | Adopted           | M3 / M5         | domain-model B              |
| [storage-adapters.md](storage-adapters.md)           | Adopted (phase 1) | M6              | domain-model A + C          |
| [vector-hybrid-search.md](vector-hybrid-search.md)   | Deferred          | M6              | fts5, indexing-jobs         |

Reviewed 2026-07-12: all decisions from the triage + deep-dives are recorded in
each doc's "Open questions" section; adopted items are merged into
[BACKLOG.md](../../BACKLOG.md).

## Work-streams (product view, adopted 2026-07-12)

Every open backlog item is sorted into five product work-streams — **A Grounded
Answers** (the agent's find → read → cite loop via MCP), **B Trust &
Verification** (anti-hallucination), **C Coverage & Acquisition**, **D
Researcher Workflow**, **E Platform & Scale** — with P0–P3 priorities scored by
distance from the agent loop. [BACKLOG.md](../../BACKLOG.md) is organized by
these streams (former Milestones 2–6 were re-sorted into them); each plan's
header table names its stream. The product review also added the two missing
loop steps as tools: `read-content` ([service-layer.md](service-layer.md), A/P0)
and `verify-quote` ([fts5-full-text-search.md](fts5-full-text-search.md), B/P1).

## Recommended landing order

1. **service-layer** — zero schema change, zero deps; gives every later plan a
   stable seam (first PR: SearchService + ContentService, `search-citations` +
   `read-content` MCP tools, tests).
2. **domain-model phase A** — migration runner + manifestations; unblocks
   everything schema-shaped. (Zotero JSON _import_ is parse-only and can land any
   time.)
3. **fts5** — chunks, FTS tables, `index` command bridge.
4. **http-api** (M5) and **zotero phase 2** (M5) — parallel once their
   dependencies exist.
5. **indexing-jobs** (M4) — absorbs the `index` command; adds resume/concurrency/watch.
6. **storage-adapters** (M6, phase 1 only — indirection + availability; HTTPS/S3
   parked in-doc). **vector-hybrid-search** is Deferred until FTS5 quality is
   observed on a real corpus.

## Corrections vs. the source exploration doc

| Source doc assumed                                                      | Verified reality                                                                                                 |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| MCP tools `get_paper`, `list_corpus`, `find_by_title`, `segment_search` | Actual tools (kebab-case): `get-citation`, `list-citations`, `import-bibtex`, `search-arxiv`, `download-pdf`     |
| FTS tables may already exist                                            | No FTS5 anywhere; only an **unexposed** `Database.searchCitations` LIKE on title/authors (`src/db/index.ts:310`) |
| HTTP framework possibly available (hono in tree)                        | No HTTP server; hono is transitive-only via the MCP SDK, not in package.json                                     |
| Segment/chunk model to evaluate                                         | No chunks/segments table exists                                                                                  |
| Extraction cached / versioned / hashed                                  | Markdown written to `papers/markdown/` only; untracked in DB; no content hashes anywhere                         |
| Page provenance for search results                                      | pdf2md flattens output — no page boundaries; provenance is **section-level** initially                           |
| "SQLite schema and migrations"                                          | No migration framework; `CREATE TABLE IF NOT EXISTS` + ad-hoc rebuild migrators (`src/db/index.ts:88`, `:158`)   |
| Metadata & source-resolution state tracked                              | Correct — `citations` + `retrieval_log` already cover this                                                       |

## Review protocol

Status lifecycle: `Proposed → Adopted | Deferred | Dropped` (docs are never
deleted; Dropped keeps a one-line rationale). A plan's backlog items merge into
[BACKLOG.md](../../BACKLOG.md) **only on Adopted**; Deferred plans keep their items
in-doc. Update the status table above whenever a header changes.
