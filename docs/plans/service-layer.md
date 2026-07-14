# Service Layer & Unified API Surface

| Field         | Value                                                         |
| ------------- | ------------------------------------------------------------- |
| Status        | **Core — slice 1 shipped · slice 3** (phases 3–5 exploratory) |
| Work-stream   | A — Grounded Answers                                          |
| Depends on    | — (foundation; no schema change, no new dependencies)         |
| Last reviewed | 2026-07-14                                                    |

## Intent

Every capability is defined **once**, as a transport-independent application
service with a shared zod contract, and exposed through gateways that do nothing
but parse → call service → format. Each service binds to a **single surface —
MCP** (the product's core); CLI and HTTP gateways are future thin adapters
written over the same services only when actually needed. Bespoke per-surface
APIs are an anti-goal. The first slice is the kernel of the core workflow:
search and read.

## Current state

- `src/services/` exists: `contracts.ts` (shared zod contracts +
  `toInputSchema`), `SearchService` (FTS5 with LIKE rescue), `ContentService`,
  the verify-quote service, `IndexService`, the chunker, and the markdown
  locator. The grounded MCP tools (`search-citations`, `read-content`,
  `verify-quote` — `src/mcp/tools/grounding.ts`) derive their `inputSchema`
  from the contracts.
- Eight MCP tools total. The five older ones (`get-citation`,
  `list-citations`, `import-bibtex`, `search-arxiv` —
  `src/mcp/tools/citations.ts`; `download-pdf` — `src/mcp/tools/retrieval.ts`)
  still hand-maintain JSON `inputSchema` blocks alongside zod validators; the
  migration is an exploratory item.
- **Import is the remaining split surface**:
  - CLI `import-bibtex` runs the full pipeline via `processBibtexFile`
    (`src/workflows/process-bibtex.ts`): parse → normalize/validate DOI →
    upsert citation → retrieve PDF → log retrieval → extract Markdown → record
    manifestations with hashes.
  - MCP `import-bibtex` (`src/mcp/tools/citations.ts`) parses, validates, and
    upserts **metadata only** — no retrieval, no extraction, no
    manifestations. Citations imported this way are invisible to the core
    loop's read/verify/index steps until a CLI import or `index` run touches
    them. Same name, different semantics.
  - The DOI normalize/validate guard is duplicated across both handlers.
- `processBibtexFile` is the de-facto import pipeline — a workflow function
  rather than a constructor-injected service, with directory defaults anchored
  on the .bib file's location.
- MCP `list-citations` has cursor pagination; CLI `list` dumps all rows.
- Does **not** exist: operation registry, HTTP server (see
  [http-api.md](http-api.md)).

## Design

Plain service classes in `src/services/`, constructor-injected with `Database` /
`RetrievalOrchestrator` — no DI container, no framework. Each operation gets one
zod request/response contract as the single source of truth. New tools derive
their MCP `inputSchema` from these contracts (zod v4 ships `z.toJSONSchema`);
migrating the five existing tools' hand-written blocks is exploratory. Future
hono route validation and CLI arg mapping derive from the same schemas when
those adapters arrive.

### Operation mapping table (source of truth for all surfaces)

| Canonical operation | Service (status)               | MCP                             | CLI (future adapter)      | HTTP (future, see http-api.md)        |
| ------------------- | ------------------------------ | ------------------------------- | ------------------------- | ------------------------------------- |
| search-citations    | SearchService.search (shipped) | `search-citations`              | `search` — exploratory    | `POST /api/v1/search`                 |
| read-content        | ContentService.read (shipped)  | `read-content`                  | —                         | `GET /api/v1/citations/{doi}/content` |
| verify-quote        | see fts5 doc (shipped)         | `verify-quote`                  | —                         | deferred                              |
| get-citation        | CitationService.get (expl.)    | `get-citation`                  | —                         | `GET /api/v1/citations/{doi}`         |
| list-citations      | CitationService.list (expl.)   | `list-citations`                | `list` (exists, no pager) | `GET /api/v1/citations`               |
| import-bibtex       | ImportService.import (slice 3) | `import-bibtex` (full, opt-out) | `import-bibtex` (full)    | deferred                              |
| download-pdf        | RetrievalService (expl.)       | `download-pdf`                  | `download`                | deferred                              |
| search-arxiv        | thin resolver call             | `search-arxiv`                  | —                         | deferred                              |
| get-references      | GraphService (expl.)           | `get-references`                | —                         | deferred                              |
| get-citing-papers   | GraphService (expl.)           | `get-citing-papers`             | —                         | deferred                              |
| related-papers      | GraphService (expl.)           | `related-papers`                | —                         | deferred                              |
| check-corpus        | GraphService (expl.)           | `check-corpus`                  | —                         | deferred                              |
| expand-corpus       | GraphService (expl.)           | `expand-corpus`                 | —                         | deferred                              |

### SearchService (slice 1)

```ts
// src/services/search.ts
interface SearchRequest {
  query: string;
  mode?: 'lexical'; // union widens via fts5 / vector plans
  filters?: {
    yearGte?: number;
    yearLte?: number;
    verificationStatus?: VerificationStatus[];
    accessType?: AccessType[];
    hasPdf?: boolean;
  };
  limit?: number; // 1–200, default 50
  cursor?: string;
}

interface SearchResponse {
  results: Array<{
    citation: CitationSummary; // doi, title, year, journal, status
    matchedFields: string[];
    matches?: SearchMatch[]; // populated from FTS5 onward; empty pre-FTS
  }>;
  nextCursor?: string;
}
```

Backed by an extended `Database.searchCitations`: journal/bibtex_key/doi join the
`LIKE` set, with `{ limit, cursor }` pagination mirroring `getAllCitations` /
`encodeCursor` (`src/db/index.ts:415`). No highlighting in v1 — `LIKE` cannot
produce honest snippets; `snippet()` arrives with FTS5. Filter support is
exploratory (the `filters` field is reserved in the contract).

Exposure is **MCP only**: a `search-citations` tool whose `inputSchema` derives
from the zod contract, plus a row in `docs/mcp-tools.md`. Results carry
**trimmed summaries** (doi, title, year, journal, status + matchedFields);
agents call `get-citation` for full detail, keeping token cost low on large
result sets.

### read-content (slice 1)

The agent's _read_ step. Without it, MCP clients get metadata and search
snippets but can never read a paper — the extracted Markdown is currently
unreachable through MCP (only `pdf_path` leaks via `get-citation`, and the
Markdown path is recorded nowhere).

```ts
// src/services/content.ts
interface ReadContentRequest {
  doi: string;
  section?: string[]; // sectionPath prefix — available once chunks exist (fts5 plan)
  cursor?: string; // character-offset pagination
  maxChars?: number; // default 20_000
}

interface ReadContentResponse {
  doi: string;
  title?: string;
  sectionPath?: string[];
  text: string;
  nextCursor?: string;
}
```

Content resolution goes through the shared markdown locator, which currently
uses the pdf_path-sibling stem heuristic and switches to manifestation-first
lookup in slice 3 ([domain-model.md](domain-model.md) phase A2). Returns
paginated whole-document text; section addressing arrives with the chunks
table ([fts5-full-text-search.md](fts5-full-text-search.md)). Exposed as a
`read-content` MCP tool.

### ImportService (slice 3)

One import pipeline, defined once, called by every surface. `processBibtexFile`
becomes the service's implementation; the CLI command and the MCP tool become
parse-args → call → format adapters.

```ts
// src/services/import.ts
interface ImportRequest {
  source: { kind: 'file'; path: string } | { kind: 'bibtex'; content: string };
  paperDir?: string; // default: file source anchors on the .bib dir; bibtex source uses env-config dirs
  markdownDir?: string; // default: sibling markdown/ of wherever paperDir resolves
  metadataOnly?: boolean; // explicit opt-out of retrieve + extract + record
  email?: string;
}

interface ImportResponse {
  imported: number;
  downloaded: number;
  extracted: number;
  skipped: Array<{ label: string; reason: string }>;
  failures: Array<{ doi: string; stage: 'download' | 'markdown'; message: string }>;
}
```

- Pipeline: parse → normalize/validate DOI → upsert citation → retrieve →
  retrieval log → extract → record manifestations (the `processBibtexFile`
  body today). The DOI guard lives here once; both handler copies are deleted.
- **Full pipeline is the default on both surfaces.** `metadataOnly: true` is
  the explicit escape hatch, advertised in the MCP tool description — a
  deliberate behavior change for MCP, streamed through the existing progress
  notifications.
- Directory resolution: file sources keep anchoring on the .bib location
  (unchanged CLI behavior); string sources (MCP has no file to anchor on) fall
  back to the env-config data dirs (`src/utils/file.ts`:
  `CITATION_NEEDED_PDF_DIR` / `CITATION_NEEDED_DIR`), with `markdownDir`
  defaulting to the sibling `markdown/` of the resolved `paperDir` — the same
  sibling convention the locator's legacy fallback assumes.
- Progress: the service keeps the existing `onProgress` callback; Ink
  `ImportProgress` (CLI) and `sendProgress` notifications (MCP) are its two
  consumers.
- Indexing stays a separate explicit step (`index` command); import does not
  chunk or touch FTS.

### Rejected / deferred alternatives

- **Operation registry** auto-exposing each op as MCP tool + HTTP route + CLI
  command: maximal DRY, but framework-y indirection for a 5-tool codebase.
  Revisit if adapter drift recurs after a second surface exists.
- **Multi-gateway plumbing now**: the CLI `search` command is a future adapter;
  parity tests ship with that second surface.
- **CitationService/DocumentService in slice 1**: extract when touched (phase
  2), not speculatively.
- **Full `SearchMatch` shape** (chunkId/pageStart/sectionPath) before chunks
  exist: the response type reserves an optional `matches` array instead.
- **Full citation JSON per search result**: trimmed summaries + `get-citation`
  follow-up instead.

## Phasing

1. **Core slice 1 (shipped)**: SearchService + ContentService,
   `search-citations` + `read-content` + `verify-quote` v1 MCP tools (v1
   design in [fts5-full-text-search.md](fts5-full-text-search.md)), tests.
2. **Core slice 3 — import consolidation**: ImportService as above; CLI and
   MCP handlers delegate; MCP `import-bibtex` defaults to the full pipeline
   with a metadata-only option; CLI/MCP parity tests.
3. **CitationService (exploratory)**: get/list delegate to one service; CLI
   `list` gains pagination parity.
4. **RetrievalService (exploratory)**: wraps the download-pdf path
   (orchestrator invocation + logging currently inline in
   `src/mcp/tools/retrieval.ts` and the CLI command); cascade shape owned by
   [retrieval-pipeline.md](retrieval-pipeline.md).
5. **Second surface (exploratory)**: CLI `search` command (reuse
   `CitationsTable`) + cross-surface parity tests.

## Backlog items

Core — slice 1 (shipped — see BACKLOG.md § Completed):

- [search] M - Extract SearchService (src/services/search.ts) with shared zod contract; lexical mode over extended Database.searchCitations (see docs/plans/service-layer.md)
- [db] S - Extend Database.searchCitations: LIKE over journal/bibtex_key/doi + limit/cursor pagination reusing encodeCursor
- [mcp] M - MCP tool: search-citations over SearchService; trimmed result summaries (see docs/plans/service-layer.md)
- [mcp] M - MCP tool: read-content — serve extracted Markdown by DOI, paginated; pdf_path-sibling stem fallback now, manifestations lookup later (see docs/plans/service-layer.md)
- [test] S - Core-tool tests: SearchService + search-citations, read-content, verify-quote v1

Core — slice 3:

- [flow] M - ImportService consolidation: CLI and MCP import-bibtex delegate to one service; MCP runs the full pipeline by default with a metadata-only option (see docs/plans/service-layer.md)
- [test] S - Import parity: the same fixture .bib through CLI and MCP yields identical citations, manifestations, retrieval-log rows, and summary counts (see docs/plans/service-layer.md)

Exploratory:

- [mcp] S - Generate MCP tool inputSchema from the shared zod contracts for all tools
- [search] S - SearchService filters: year range, verification status, access type, has-pdf
- [cli] M - `search` CLI command as second-surface adapter + MCP/CLI parity test
- [flow] S - CitationService consolidation: MCP get/list and CLI list delegate to one service; CLI list gains pagination

## Testing

- SearchService unit tests against a temp-file DB (pattern in
  `test/unit/db/database.test.ts`).
- MCP handler tests asserting the contract (valid args, zod rejection shape,
  empty results, trimmed summary shape).
- read-content: pagination cursors, stem-fallback resolution, missing-markdown
  error shape.
- Cursor stability test (insert during pagination; no skips/dupes).
- Import parity (slice 3): one fixture .bib through the CLI adapter and the
  MCP adapter → identical citations, manifestations, retrieval-log rows, and
  summary counts; `metadataOnly` leaves no manifestations and triggers no
  retrieval.
- With the second surface: parity test — same query through MCP handler and CLI
  produces identical result sets.

## Open questions

None currently.

## Relationship to other plans

- [fts5-full-text-search.md](fts5-full-text-search.md) — swaps SearchService
  internals from LIKE to FTS5 (contract unchanged); hosts the verify-quote
  design, whose v1 ships in slice 1.
- [http-api.md](http-api.md) — binds the same services as a later gateway; owns
  the HTTP column of the mapping table.
- [vector-hybrid-search.md](vector-hybrid-search.md) — widens the `mode` union.
- [domain-model.md](domain-model.md) — orthogonal (schema); its phase A2 gives
  the shared locator manifestation-first resolution.
- [retrieval-pipeline.md](retrieval-pipeline.md) — owns the cascade shape that
  ImportService (via the orchestrator) and RetrievalService invoke.
- [zotero-integration.md](zotero-integration.md) — its importer should reuse
  ImportService once slice 3 lands.
- [citation-graph.md](citation-graph.md) — GraphService follows the same shared
  zod-contract pattern; its operations appear in the mapping table.
