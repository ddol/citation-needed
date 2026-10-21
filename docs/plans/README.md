# Plans

Designs for evolving citation-needed from a BibTeX → PDF/Markdown corpus with
grounded search into a **source dossier compiler**: hand it one source, and
several models, checked against a deterministic evidence layer, produce a
faithful digest with its mathematics reproduced, its diagrams described, and a
standardized provenance footer.

These docs describe work that is **designed but not built**. For what exists
today, see [architecture.md](../architecture.md) (structure),
[DESIGN.md](../../DESIGN.md) (the rules the code follows), and
[README.md](../../README.md) (usage). Scheduled work lives in
[BACKLOG.md](../../BACKLOG.md).

Out of scope, permanently: replacing Zotero's UI, PDF reader, or citation
tooling; file servers; existing directory structures; reviewing or ranking
sources. The evidence layer (retrieval, extraction, search, quote verification)
stays deterministic, and models write only what that layer can check. SQLite
stays until benchmarks object, and there is **one operation vocabulary in a
single service layer**, bound to one surface first per capability (the web UI
for dossiers, MCP for grounded search), with other surfaces as thin gateways.

## Target boundary

```
  a source: DOI · arXiv id · library citation · PDF upload
        │
        ▼
  evidence layer  (acquire → extract → profile → chunk → index)     deterministic
        │
        ▼
  model stages    (math · figures · read → compose)                  provider roles
        │
        ▼
  checks          (quotes · numbers · LaTeX · coverage · audit)      deterministic + auditor
        │
        ▼
  dossier         (<stem>.dossier.json → .md, web view, provenance footer)
        │
        ▼
  web UI (serve, loopback) · MCP (stdio) · CLI
```

## Scope: Core vs Exploratory

**Core** is one workflow, **a faithful dossier for any source**, tracked and
configured from a local web UI. Slices 1–3 (the grounded search loop) are
shipped and become the evidence layer. Slices 4–8 build the dossier:

| Slice | Delivers                                                                                                                     | Plans                             |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 4     | keys and models: SvelteKit + svelte-ux shell under `serve`, settings page, secrets store, provider adapters, role assignment | model-providers, web-ui, http-api |
| 5     | first dossier: jobs, profile, text digests, quote/number/coverage gates, footer, progress page                               | dossier, indexing-jobs, web-ui    |
| 6     | math and diagrams: rasterizer, LaTeX with two transcriptions, figure descriptions, KaTeX view                                | visual-extraction, web-ui         |
| 7     | independent audit: auditor findings, one revision pass, cost estimate, dossier eval                                          | dossier, model-providers          |
| 8     | any source: PDF upload with DOI-less admission, long-form hierarchical digests                                               | dossier, domain-model, web-ui     |

**Exploratory** is everything else: designed, parked in these docs, unscheduled
until the dossier workflow proves valuable in daily use. Nothing is deleted.

## Plan status

| Plan                                                         | Status                           | Flow               | Depends on                                                                        |
| ------------------------------------------------------------ | -------------------------------- | ------------------ | --------------------------------------------------------------------------------- |
| [dossier.md](dossier.md)                                     | Core: slices 5–8                 | Dossier            | model-providers, indexing-jobs, visual-extraction, web-ui                         |
| [model-providers.md](model-providers.md)                     | Core: slice 4                    | Infrastructure     | http-api, web-ui                                                                  |
| [web-ui.md](web-ui.md)                                       | Core: slices 4–8                 | Infrastructure     | http-api, model-providers, indexing-jobs, dossier                                 |
| [visual-extraction.md](visual-extraction.md)                 | Core: slice 6                    | Dossier            | verification/ extraction pipeline, model-providers                                |
| [indexing-jobs.md](indexing-jobs.md)                         | Core: slice 5 (dossier jobs)     | Infrastructure     | domain-model, fts5                                                                |
| [http-api.md](http-api.md)                                   | Core: slice 4 (server, security) | Infrastructure     | service-layer                                                                     |
| [service-layer.md](service-layer.md)                         | Core: slices 1, 3 shipped        | A                  | none                                                                              |
| [domain-model.md](domain-model.md)                           | Core: slices 2, 3 shipped        | Infrastructure     | none                                                                              |
| [fts5-full-text-search.md](fts5-full-text-search.md)         | Core: slices 1–2 shipped         | A                  | service-layer, domain-model                                                       |
| [retrieval-pipeline.md](retrieval-pipeline.md)               | Core: slice 3 shipped            | C                  | none                                                                              |
| [claim-grounding-eval.md](claim-grounding-eval.md)           | Exploratory                      | B                  | service-layer, fts5-full-text-search                                              |
| [corpus-knowledge.md](corpus-knowledge.md)                   | Proposed                         | B (new sources: C) | fts5, domain-model, model-providers, indexing-jobs, dossier, vector-hybrid-search |
| [zotero-integration.md](zotero-integration.md)               | Exploratory                      | A                  | domain-model                                                                      |
| [storage-adapters.md](storage-adapters.md)                   | Exploratory                      | Infrastructure     | domain-model                                                                      |
| [citation-graph.md](citation-graph.md)                       | Exploratory                      | C                  | domain-model, indexing-jobs                                                       |
| [local-bibliography-spider.md](local-bibliography-spider.md) | Exploratory                      | C                  | domain-model, fts5-full-text-search, later citation-graph                         |
| [vector-hybrid-search.md](vector-hybrid-search.md)           | Deferred                         | A                  | fts5, indexing-jobs                                                               |

## Flows

One rubric, shared with [BACKLOG.md](../../BACKLOG.md), describing which user
journey a piece of work serves:

- **Dossier**: a researcher hands over one source and receives a faithful
  digest of it: comprehension, mathematics, diagrams, provenance.
- **Flow A, own-library authoring**: a researcher uses their own paper library in their own work.
- **Flow B, claims from papers already held**: checking others' claims when the papers are present.
- **Flow C, claims from papers not yet held**: checking others' claims when papers may be missing.
- **Infrastructure**: foundations, secondary surfaces, scale, packaging, deployment.

## Architecture principles

The research assistant is **core + satellites**. citation-needed owns the
dossier pipeline, the grounded corpus it checks against, and (when that work
graduates from exploratory) the citation graph, because graph value is joins
against corpus state. The agent remains a shell composing small tools over MCP.
Satellites handle scheduling (cron/launchd), trend reports (files), and
third-party scouts, composing through the pipe contract: BibTeX/JSONL in via
`citation-needed import`, dossier and report files out. The SQLite DB is **not**
a public API for siblings (read-only at most). The job worker runs in-process
under `serve`; no scheduler lives in the core.

## Ownership boundaries

Where two plans could each claim a piece of work:

- **Model calls** belong to [model-providers.md](model-providers.md). Dossier
  stages, the math and figure stages, and any future generated feature call
  roles through it; none opens its own client.
- **Server security and conventions** belong to [http-api.md](http-api.md);
  [web-ui.md](web-ui.md) owns pages and the settings and dossier routes.
- **Region location** (where an equation, figure, or table sits) belongs to
  [visual-extraction.md](visual-extraction.md), built on the page maps in
  `verification/markdown.ts`; the dossier profile consumes it.
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

1. **Slice 4, keys and models**: the web UI shell and settings page work end to
   end against all three providers before any dossier logic exists.
2. **Slice 5, first dossier**: a text dossier with verified quotes and numbers,
   a footer, and live progress.
3. **Slice 6, math and diagrams**: the parts the user most needs and models most
   often get wrong, each with deterministic checks.
4. **Slice 7, independent audit**: the second model family and the eval that
   tunes role assignments.
5. **Slice 8, any source**: uploads, DOI-less identity, long-form sources.
6. **Re-triage Exploratory** against real dossier usage.

## Needs a plan before scheduling

- Small CLI/MCP maintenance commands (`stats`, `update`, `get-retrieval-log`,
  `update-citation`, `delete-citation`) need a CitationService/RetrievalService
  detail pass when a second surface is scheduled.
- Import/export formats (`RIS`, `CSV`, `export`) need a format-interop plan.
- Non-PDF dossier sources (HTML articles, EPUB, slides) need a source-format
  plan.
- TUI expansion, npm/Docker/systemd packaging, SAML/Shibboleth, database
  backup/restore, and webhook notifications are backlog-only by intent.

## Review protocol

Statuses: `Proposed → Core | Exploratory | Deferred | Dropped`. Docs are never
deleted; Dropped keeps a one-line rationale. Each doc's header table carries its
status and Flow; keep the table above in sync with the headers. Deferred work
stays in its plan doc until adopted.
