# Plans

Designs for evolving citation-needed from a BibTeX → PDF/Markdown retrieval
sidecar into the local **search, indexing, and document-resolution layer** for an
academic corpus.

These docs describe work that is **designed but not built**. For what exists
today, see [architecture.md](../architecture.md) (structure),
[DESIGN.md](../../DESIGN.md) (the rules the code follows), and
[README.md](../../README.md) (usage). Scheduled work lives in
[BACKLOG.md](../../BACKLOG.md).

Out of scope, permanently: replacing Zotero's UI, PDF reader, or citation
tooling; file servers; existing directory structures. The search core stays
deterministic (LLM features live outside it), SQLite stays until benchmarks
object, and there is **one operation vocabulary in a single service layer**,
bound to MCP first, with CLI/HTTP as thin gateways, never per-surface APIs.

## Target boundary

```
  BibTeX files · Zotero exports · Unpaywall / Semantic Scholar / arXiv · publisher PDFs
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

## Scope: Core vs Exploratory

**Core** is one workflow, **grounded answers from your own library**: import →
download/extract → index → find (`search-citations`) → read (`read-content`) →
check (`verify-quote`), all over MCP. Slices 1–3 are shipped; slice 4 measures
whether the extraction the pipeline invests in actually helps an agent answer
claim-verification questions.

**Exploratory** is everything else: designed, parked in these docs, unscheduled
until the core loop proves valuable in daily use. Nothing is deleted.

## Plan status

| Plan                                                         | Status                    | Flow           | Depends on                                                |
| ------------------------------------------------------------ | ------------------------- | -------------- | --------------------------------------------------------- |
| [service-layer.md](service-layer.md)                         | Core: slices 1, 3 shipped | A              | none                                                      |
| [domain-model.md](domain-model.md)                           | Core: slices 2, 3 shipped | Infrastructure | none                                                      |
| [fts5-full-text-search.md](fts5-full-text-search.md)         | Core: slices 1–2 shipped  | A              | service-layer, domain-model                               |
| [retrieval-pipeline.md](retrieval-pipeline.md)               | Core: slice 3 shipped     | C              | none                                                      |
| [indexing-jobs.md](indexing-jobs.md)                         | Exploratory               | Infrastructure | domain-model, fts5                                        |
| [http-api.md](http-api.md)                                   | Exploratory               | Infrastructure | service-layer                                             |
| [zotero-integration.md](zotero-integration.md)               | Exploratory               | A              | domain-model                                              |
| [storage-adapters.md](storage-adapters.md)                   | Exploratory               | Infrastructure | domain-model                                              |
| [vector-hybrid-search.md](vector-hybrid-search.md)           | Deferred                  | A              | fts5, indexing-jobs                                       |
| [citation-graph.md](citation-graph.md)                       | Exploratory               | C              | domain-model, indexing-jobs                               |
| [local-bibliography-spider.md](local-bibliography-spider.md) | Exploratory               | C              | domain-model, fts5-full-text-search, later citation-graph |
| [visual-extraction.md](visual-extraction.md)                 | Exploratory               | Infrastructure | verification/ extraction pipeline                         |
| [claim-grounding-eval.md](claim-grounding-eval.md)           | Core (slice 4)            | B              | service-layer, fts5-full-text-search                      |

## Flows

One rubric, shared with [BACKLOG.md](../../BACKLOG.md), describing which user
journey a piece of work serves:

- **Flow A, own-library authoring**: a researcher uses their own paper library in their own work.
- **Flow B, claims from papers already held**: checking others' claims when the papers are present.
- **Flow C, claims from papers not yet held**: checking others' claims when papers may be missing.
- **Infrastructure**: foundations, secondary surfaces, scale, packaging, deployment.

## Architecture principles

The research assistant is **core + satellites**: the agent is the shell,
composing small tools (MCP servers, CLIs, cron). citation-needed owns the
grounded corpus and (when that work graduates from exploratory) its citation
graph, because graph value is joins against corpus state. Satellites handle
scheduling (cron/launchd), trend digests (files), and third-party scouts,
composing through the pipe contract: BibTeX/JSONL in via `citation-needed
import`, digest files out; the SQLite DB is **not** a public API for siblings
(read-only at most). No scheduler lives in the core.

## Ownership boundaries

Where two plans could each claim a piece of work:

- **Extracted references** belong to
  [local-bibliography-spider.md](local-bibliography-spider.md). The citation
  graph consumes accepted edges and cross-checks graph-source edges against
  extracted evidence; it does not own a second parser.
- **Crossref enrichment** is one shared client, not parallel fetchers:
  [retrieval-pipeline.md](retrieval-pipeline.md) parks `DoiResolver`, while
  [local-bibliography-spider.md](local-bibliography-spider.md) needs enrichment
  for parsed references.
- **Semantic Scholar** has two consumers. The retrieval resolver
  (`src/retrieval/resolvers/semantic-scholar.ts`) is built and owned by
  [retrieval-pipeline.md](retrieval-pipeline.md); the `GraphSource` client in
  [citation-graph.md](citation-graph.md) is exploratory and must reuse it rather
  than add a second client.
- **Open-access URLs from graph sources** enter the cascade only through the
  re-entry gate in [retrieval-pipeline.md](retrieval-pipeline.md);
  [citation-graph.md](citation-graph.md) owns discovery, not downloader ordering.

## Landing order

1. ~~**Core slice 3, one pipeline, one locator**~~: shipped. Manifestation-first
   locator with self-healing fallback (domain-model), ImportService
   consolidation with full-pipeline MCP default (service-layer), test-harness
   guardrails, cascade trims (retrieval-pipeline).
2. **Core slice 4, is the pipeline worth its own code?**: token economics, then
   the claim-grounding eval and its decision memo
   ([claim-grounding-eval.md](claim-grounding-eval.md)). The result decides
   whether the parser expands, shrinks, or stays.
3. **Re-triage Exploratory** against real usage of the core loop.

## Needs a plan before scheduling

- Small CLI/MCP maintenance commands (`stats`, `update`, `get-retrieval-log`,
  `update-citation`, `delete-citation`) need a CitationService/RetrievalService
  detail pass when a second surface is scheduled.
- Import/export formats (`RIS`, `CSV`, `export`) need a format-interop plan.
- TUI expansion, npm/Docker/systemd packaging, SAML/Shibboleth, database
  backup/restore, and webhook notifications are backlog-only by intent.

## Review protocol

Statuses: `Proposed → Core | Exploratory | Deferred | Dropped`. Docs are never
deleted; Dropped keeps a one-line rationale. Each doc's header table carries its
status and Flow; keep the table above in sync with the headers. Deferred work
stays in its plan doc until adopted.
