# Service Layer & Unified API Surface

| Field         | Value                                                 |
| ------------- | ----------------------------------------------------- |
| Status        | **Core — slice 1** (phases 2–4 exploratory)           |
| Work-stream   | A — Grounded Answers                                  |
| Depends on    | — (foundation; no schema change, no new dependencies) |
| Last reviewed | 2026-07-12                                            |

## Intent

Every capability is defined **once**, as a transport-independent application
service with a shared zod contract, and exposed through gateways that do nothing
but parse → call service → format. Each service binds to a **single surface —
MCP** (the product's core); CLI and HTTP gateways are future thin adapters
written over the same services only when actually needed. Bespoke per-surface
APIs are an anti-goal. The first slice is the kernel of the core workflow:
search and read.

## Current state

- There is no `src/services/` directory. Business logic lives in the `Database`
  class (`src/db/index.ts`), `RetrievalOrchestrator` (`src/retrieval/index.ts`), and
  `processBibtexFile` (`src/workflows/process-bibtex.ts`); MCP and CLI handlers call
  these directly and inline some logic.
- `Database.searchCitations(query)` (`src/db/index.ts:310`) does `LIKE` over
  title/authors only, no pagination — and is **exposed by no CLI command and no MCP
  tool** (referenced only in tests).
- Actual MCP tools (5, kebab-case): `get-citation`, `list-citations`,
  `import-bibtex`, `search-arxiv` (`src/mcp/tools/citations.ts`), `download-pdf`
  (`src/mcp/tools/retrieval.ts`).
- Per-surface divergences that motivate this plan:
  - MCP `import-bibtex` imports **metadata only** (`src/mcp/tools/citations.ts:116`)
    while CLI `import-bibtex` runs the full download + extraction pipeline via
    `processBibtexFile` — same name, different semantics.
  - DOI normalize/validate duplicated: `src/mcp/tools/citations.ts:127` vs
    `src/workflows/process-bibtex.ts:111`.
  - MCP `list-citations` has cursor pagination; CLI `list` dumps all rows.
  - MCP tool `inputSchema` JSON blocks are hand-maintained in parallel with the zod
    validators (`src/mcp/tools/citations.ts:7` vs `:24`) — two sources of truth for
    the same contract.
- Does **not** exist: service layer, operation registry, HTTP server (see
  [http-api.md](http-api.md)), FTS (see
  [fts5-full-text-search.md](fts5-full-text-search.md)).

## Design

Plain service classes in `src/services/`, constructor-injected with `Database` /
`RetrievalOrchestrator` — no DI container, no framework. Each operation gets one
zod request/response contract as the single source of truth. New tools derive
their MCP `inputSchema` from these contracts (zod v4 ships `z.toJSONSchema`);
migrating the five existing tools' hand-written blocks is exploratory. Future
hono route validation and CLI arg mapping derive from the same schemas when
those adapters arrive.

### Operation mapping table (source of truth for all surfaces)

| Canonical operation | Service (phase)          | MCP                             | CLI (future adapter)      | HTTP (future, see http-api.md)        |
| ------------------- | ------------------------ | ------------------------------- | ------------------------- | ------------------------------------- |
| search-citations    | SearchService.search (1) | `search-citations` — slice 1    | `search` — exploratory    | `POST /api/v1/search`                 |
| read-content        | ContentService.read (1)  | `read-content` — slice 1        | —                         | `GET /api/v1/citations/{doi}/content` |
| verify-quote        | see fts5 doc (1)         | `verify-quote` — slice 1        | —                         | deferred                              |
| get-citation        | CitationService.get (2)  | `get-citation`                  | —                         | `GET /api/v1/citations/{doi}`         |
| list-citations      | CitationService.list (2) | `list-citations`                | `list` (exists, no pager) | `GET /api/v1/citations`               |
| import-bibtex       | ImportService.import (2) | `import-bibtex` (full, opt-out) | `import-bibtex` (full)    | deferred                              |
| download-pdf        | RetrievalService (3)     | `download-pdf`                  | `download`                | deferred                              |
| search-arxiv        | thin resolver call       | `search-arxiv`                  | —                         | deferred                              |
| get-references      | GraphService (expl.)     | `get-references`                | —                         | deferred                              |
| get-citing-papers   | GraphService (expl.)     | `get-citing-papers`             | —                         | deferred                              |
| related-papers      | GraphService (expl.)     | `related-papers`                | —                         | deferred                              |
| check-corpus        | GraphService (expl.)     | `check-corpus`                  | —                         | deferred                              |
| expand-corpus       | GraphService (expl.)     | `expand-corpus`                 | —                         | deferred                              |

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

v1 resolves the extracted Markdown via the pdf_path-sibling heuristic
(`…/papers/markdown/<stem>.md`), switching to manifestations lookup when
[domain-model.md](domain-model.md) phase A lands, and returns paginated
whole-document text. Section addressing arrives with the chunks table
([fts5-full-text-search.md](fts5-full-text-search.md)). Exposed as a
`read-content` MCP tool.

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

1. **Core slice 1 (the next PR)**: SearchService + ContentService,
   `search-citations` + `read-content` + `verify-quote` v1 MCP tools (v1 design
   in [fts5-full-text-search.md](fts5-full-text-search.md)), tests. No schema
   change, no new dependencies, single surface.
2. **Consolidation (exploratory)**: CitationService/ImportService wrap the
   existing dual-surface get/list/import ops; both existing handlers delegate.
   The MCP `import-bibtex` tool switches to the **full pipeline by default**
   (download + extract, matching the CLI) with an explicit metadata-only
   option — a deliberate behavior change, advertised in the tool description
   and streamed via the existing progress notifications.
3. **RetrievalService (exploratory)**: wraps the download-pdf path
   (orchestrator invocation + logging currently inline in
   `src/mcp/tools/retrieval.ts` and the CLI command).
4. **Second surface (exploratory)**: CLI `search` command (reuse
   `CitationsTable`) + cross-surface parity tests.

## Backlog items

Core — slice 1:

- [search] M - Extract SearchService (src/services/search.ts) with shared zod contract; lexical mode over extended Database.searchCitations (see docs/plans/service-layer.md)
- [db] S - Extend Database.searchCitations: LIKE over journal/bibtex_key/doi + limit/cursor pagination reusing encodeCursor
- [mcp] M - MCP tool: search-citations over SearchService; trimmed result summaries (see docs/plans/service-layer.md)
- [mcp] M - MCP tool: read-content — serve extracted Markdown by DOI, paginated; pdf_path-sibling stem fallback now, manifestations lookup later (see docs/plans/service-layer.md)
- [test] S - Core-tool tests: SearchService + search-citations, read-content, verify-quote v1

Exploratory:

- [mcp] S - Generate MCP tool inputSchema from the shared zod contracts for all tools
- [search] S - SearchService filters: year range, verification status, access type, has-pdf
- [cli] M - `search` CLI command as second-surface adapter + MCP/CLI parity test
- [flow] M - CitationService/ImportService consolidation; MCP import gains full pipeline by default with a metadata-only option

## Testing

- SearchService unit tests against a temp-file DB (pattern in
  `test/unit/db/database.test.ts`).
- MCP handler tests asserting the contract (valid args, zod rejection shape,
  empty results, trimmed summary shape).
- read-content: pagination cursors, stem-fallback resolution, missing-markdown
  error shape.
- Cursor stability test (insert during pagination; no skips/dupes).
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
- [domain-model.md](domain-model.md) — orthogonal (schema); read-content
  switches to manifestations lookup once phase A lands.
- [zotero-integration.md](zotero-integration.md) — its importer should reuse
  ImportService once phase 2 lands.
- [citation-graph.md](citation-graph.md) — GraphService follows the same shared
  zod-contract pattern; its operations appear in the mapping table.
