# Plans

Plan documents for evolving citation-needed from a BibTeX → PDF/Markdown
retrieval sidecar into the local **search, indexing, and document-resolution
layer** for an academic corpus. It explicitly does **not** replace Zotero's UI,
PDF reader, or citation tooling, nor file servers or existing directory
structures. The search core stays deterministic (LLM features live outside it),
SQLite stays until benchmarks object, and there is **one operation vocabulary in
a single service layer — bound to MCP first, with CLI/HTTP as future thin
gateways — never per-surface APIs**.

## Target boundary

```
  BibTeX files · Zotero exports · arXiv / Unpaywall / Crossref · publisher PDFs
        │
        ▼
  citation-needed  (ingest → resolve → download → extract → chunk → index)
        │
        ▼
  SQLite: citations · retrieval_log · manifestations · chunks · FTS5
        │
        ▼
  MCP (stdio, today) · CLI · HTTP /api/v1 (future) · zotero:// links
```

## Core scope

The scheduled surface is one workflow: **grounded answers from your own
library** — import → download/extract → index → find (`search-citations`) →
read (`read-content`) → check (`verify-quote`), all over MCP. Three slices,
tracked in [BACKLOG.md](../../BACKLOG.md) § Core: slices 1–2 are shipped; slice
3 consolidates what they left split — one import pipeline,
manifestation-first content resolution, an honest retrieval cascade, and
test-harness guardrails. Everything else is **Exploratory**: designed, parked
in these docs, unscheduled until the core loop proves valuable in daily use.
Interim discovery: compose a community Semantic Scholar/OpenAlex MCP server
alongside citation-needed.

## Plan status

| Plan                                                         | Status                           | Work-stream | Depends on                                                |
| ------------------------------------------------------------ | -------------------------------- | ----------- | --------------------------------------------------------- |
| [service-layer.md](service-layer.md)                         | Core — slice 1 shipped · slice 3 | A           | —                                                         |
| [domain-model.md](domain-model.md)                           | Core — slice 2 shipped · slice 3 | E           | —                                                         |
| [fts5-full-text-search.md](fts5-full-text-search.md)         | Core — slices 1–2 shipped        | A           | service-layer, domain-model                               |
| [retrieval-pipeline.md](retrieval-pipeline.md)               | Core — slice 3 (trims)           | C           | —                                                         |
| [indexing-jobs.md](indexing-jobs.md)                         | Exploratory                      | E           | domain-model, fts5                                        |
| [http-api.md](http-api.md)                                   | Exploratory                      | D           | service-layer                                             |
| [zotero-integration.md](zotero-integration.md)               | Exploratory                      | D           | domain-model                                              |
| [storage-adapters.md](storage-adapters.md)                   | Exploratory                      | E           | domain-model                                              |
| [vector-hybrid-search.md](vector-hybrid-search.md)           | Deferred                         | A           | fts5, indexing-jobs                                       |
| [citation-graph.md](citation-graph.md)                       | Exploratory                      | C           | domain-model, indexing-jobs                               |
| [local-bibliography-spider.md](local-bibliography-spider.md) | Exploratory                      | C           | domain-model, fts5-full-text-search, later citation-graph |

## Work-streams

Used to organize the Exploratory section of the backlog for future re-triage:

- **A — Grounded Answers**: on the agent's find → read → cite path via MCP
- **B — Trust & Verification**: lets a claim or the corpus's state be checked
- **C — Coverage & Acquisition**: raises the fraction of relevant papers present and readable
- **D — Researcher Workflow**: fits existing human workflows and frontends
- **E — Platform & Scale**: the foundations the other streams stand on

## Architecture principles

The research assistant is **core + satellites**: the agent is the shell,
composing small tools (MCP servers, CLIs, cron). citation-needed owns the
grounded corpus and — when that work graduates from exploratory — its citation
graph, because graph value is joins against corpus state. Satellites handle
scheduling (cron/launchd), trend digests (files), and third-party scouts,
composing through the pipe contract: BibTeX/JSONL in via `citation-needed
import`, digest files out; the SQLite DB is **not** a public API for siblings
(read-only at most). No scheduler lives in the core.

## Landing order

Slices 1–2 are shipped ([BACKLOG.md](../../BACKLOG.md) § Completed). Next:

1. **Core slice 3 — one pipeline, one locator**: manifestation-first locator
   with self-healing fallback (domain-model phase A2) → ImportService
   consolidation with full-pipeline MCP default (service-layer) →
   test-harness guardrails → cascade trims (retrieval-pipeline).
2. **Re-triage Exploratory** against real usage of the core loop
   ([BACKLOG.md](../../BACKLOG.md) § Exploratory).

## Review protocol

Doc statuses: `Proposed → Core | Exploratory | Deferred | Dropped`. Docs are
never deleted; Dropped keeps a one-line rationale. Backlog items are scheduled
in [BACKLOG.md](../../BACKLOG.md) only for Core plans; Exploratory and Deferred
plans keep their items parked. Keep the status table above in sync with the doc
headers.
