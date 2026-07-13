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

| Plan                                                 | Status                   | Milestone(s)    | Depends on                  |
| ---------------------------------------------------- | ------------------------ | --------------- | --------------------------- |
| [service-layer.md](service-layer.md)                 | Adopted — CORE (slice 1) | M3              | —                           |
| [domain-model.md](domain-model.md)                   | Adopted — CORE (phase A) | M3 / M5 / M6    | —                           |
| [fts5-full-text-search.md](fts5-full-text-search.md) | Adopted — CORE (slice 2) | M3 (+ M4 bench) | service-layer, domain-model |
| [indexing-jobs.md](indexing-jobs.md)                 | Exploratory              | M4              | domain-model, fts5          |
| [http-api.md](http-api.md)                           | Exploratory              | M5              | service-layer (fts5 soft)   |
| [zotero-integration.md](zotero-integration.md)       | Exploratory              | M3 / M5         | domain-model B              |
| [storage-adapters.md](storage-adapters.md)           | Exploratory              | M6              | domain-model A + C          |
| [vector-hybrid-search.md](vector-hybrid-search.md)   | Deferred (≈ Exploratory) | M6              | fts5, indexing-jobs         |
| [citation-graph.md](citation-graph.md)               | Exploratory              | — (streams C+A) | domain-model, indexing-jobs |

Reviewed 2026-07-12: all decisions from the triage + deep-dives are recorded in
each doc's "Open questions" section; adopted items are merged into
[BACKLOG.md](../../BACKLOG.md).

## Core scope (2026-07-12 ruthless cut)

The scheduled surface is one workflow: **grounded answers from your own
library** — import → download/extract (works today) → index → find
(`search-citations`) → read (`read-content`) → check (`verify-quote`), all over
MCP. Two slices, 18 items: [BACKLOG.md](../../BACKLOG.md) § Core. Everything
else is **Exploratory** — designed, parked in these docs, unscheduled until the
core loop proves valuable in daily use. Interim discovery: compose a community
Semantic Scholar/OpenAlex MCP server alongside citation-needed. Notable
demotions with the cut: the citation-graph plan (compose externally meanwhile),
the zod-inputSchema migration for existing tools, and all HTTP / Zotero / jobs /
storage work.

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

### Decomposition principles (2026-07-12)

The research assistant is **core + satellites**: the agent is the shell,
composing small tools (MCP servers, CLIs, cron). citation-needed owns the
grounded corpus _and its citation graph_ ([citation-graph.md](citation-graph.md)
— graph value is joins against corpus state); satellites handle scheduling
(cron/launchd), trend digests (files), and third-party scouts, composing
through the pipe contract: BibTeX/JSONL in via `citation-needed import`, digest
files out, and the SQLite DB is **not** a public API for siblings (read-only at
most). No scheduler lives in the core. Recorded evaluations: external extractor
filter contract (fts5 doc), TUI slimming (stream D/P3).

## Landing order (post scope cut)

1. **Core slice 1 — kernel** (service-layer): SearchService + `search-citations`,
   `read-content`, `verify-quote` v1, tests. No schema changes, no new
   dependencies — one PR.
2. **Core slice 2 — grounded full-text search** (domain-model phase A + fts5):
   migration runner → manifestations → hashes → chunker → chunks → FTS5 →
   `index` command → verify-quote v2.
3. **Re-triage Exploratory** against real usage of the core loop
   ([BACKLOG.md](../../BACKLOG.md) § Exploratory — streams and former
   priorities retained there).

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
