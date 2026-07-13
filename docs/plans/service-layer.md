# Service Layer & Unified API Surface

| Field         | Value                                                   |
| ------------- | ------------------------------------------------------- |
| Status        | **Adopted** (2026-07-12 review)                         |
| Milestone(s)  | M3                                                      |
| Work-stream   | A — Grounded Answers                                    |
| Depends on    | — (foundation; no schema change, no new dependencies)   |
| Absorbs       | Source exploration §3, §9 (lexical parts), §17, Phase 1 |
| Last reviewed | 2026-07-12                                              |

## Intent

Every capability should be defined **once**, as a transport-independent application
service with a shared zod contract, and exposed through gateways that do nothing but
parse → call service → format. Initially each service binds to a **single surface —
MCP** (the product's core); CLI and HTTP gateways are future thin adapters written
over the same services only when actually needed. Bespoke per-surface APIs are an
anti-goal. The first slice is search, which today exists in the DB layer but is
exposed by nothing.

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
`RetrievalOrchestrator` — no DI container, no framework. Each operation gets one zod
request/response contract that is the single source of truth: **all MCP tool
`inputSchema` blocks are generated from the zod contracts in phase 1** (zod v4
ships `z.toJSONSchema`; decided at review — the hand-written JSON Schema blocks go
away for all six tools, not just the new one). Future hono route validation and CLI
arg mapping derive from the same schemas when those adapters arrive.

### Operation mapping table (source of truth for all surfaces)

| Canonical operation | Service (phase)          | MCP (today)                     | CLI (future adapter)      | HTTP (future, see http-api.md)        |
| ------------------- | ------------------------ | ------------------------------- | ------------------------- | ------------------------------------- |
| search-citations    | SearchService.search (1) | `search-citations` — new        | `search` — planned        | `POST /api/v1/search`                 |
| read-content        | ContentService.read (1)  | `read-content` — new            | —                         | `GET /api/v1/citations/{doi}/content` |
| get-citation        | CitationService.get (2)  | `get-citation`                  | —                         | `GET /api/v1/citations/{doi}`         |
| list-citations      | CitationService.list (2) | `list-citations`                | `list` (exists, no pager) | `GET /api/v1/citations`               |
| import-bibtex       | ImportService.import (2) | `import-bibtex` (full, opt-out) | `import-bibtex` (full)    | deferred                              |
| download-pdf        | RetrievalService (3)     | `download-pdf`                  | `download`                | deferred                              |
| search-arxiv        | thin resolver call       | `search-arxiv`                  | —                         | deferred                              |

### SearchService (first slice)

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
    citation: CitationSummary; // doi, title, year, journal, status (decided at review)
    matchedFields: string[];
    matches?: SearchMatch[]; // populated from FTS5 onward; empty pre-FTS
  }>;
  nextCursor?: string;
}
```

Backed by an extended `Database.searchCitations`: add journal/bibtex_key/doi to the
`LIKE` set and `{ limit, cursor }` pagination mirroring `getAllCitations` /
`encodeCursor` (`src/db/index.ts:415`). No highlighting in v1 — `LIKE` cannot
produce honest snippets; `snippet()` arrives with FTS5.

Exposure in phase 1 is **MCP only**: a new `search-citations` tool whose
`inputSchema` derives from the zod contract, plus a row in `docs/mcp-tools.md`.
Results carry **trimmed summaries** (doi, title, year, journal, status +
matchedFields); agents call `get-citation` for full detail — decided at review to
keep token cost low on large result sets.

### read-content (added 2026-07-12 product review; stream A, P0)

The agent's _read_ step. Without it, MCP clients get metadata and search snippets
but can never read a paper — the extracted Markdown is currently unreachable
through MCP (only `pdf_path` leaks via `get-citation`, and the Markdown path is
recorded nowhere). For a product promising grounded LLM knowledge via MCP, this
gap outranks everything except search itself.

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

v1 resolves the extracted Markdown via manifestations when present
([domain-model.md](domain-model.md)), falling back to the pdf_path-sibling
heuristic (`…/papers/markdown/<stem>.md`) for pre-migration rows, and returns
paginated whole-document text. Section addressing arrives with the chunks table
([fts5-full-text-search.md](fts5-full-text-search.md)). Exposed as a
`read-content` MCP tool in phase 1.

### Rejected / deferred alternatives

- **Operation registry** auto-exposing each op as MCP tool + HTTP route + CLI
  command: maximal DRY, but framework-y indirection for a 5-tool codebase. Revisit
  if adapter drift recurs after a second surface exists.
- **Multi-gateway plumbing now**: the CLI `search` command is deferred to a
  follow-up adapter; parity tests ship with that second surface.
- **CitationService/DocumentService in phase 1**: extract when touched (phase 2),
  not speculatively.
- **Porting the source doc's full `SearchMatch`** (chunkId/pageStart/sectionPath)
  before chunks exist: the response type reserves an optional `matches` array
  instead.
- **Full citation JSON per search result**: rejected at review in favor of trimmed
  summaries + `get-citation` follow-up.

## Phasing

1. **SearchService + ContentService + `search-citations` and `read-content` MCP
   tools + zod-generated inputSchema for all tools + tests** — the recommended
   first PR. No schema change, no new dependencies, single surface. (The source doc's suggested first PR bundled HTTP
   `/api/v1/search`; that is wrong for this repo — no HTTP server exists, so it
   would add a framework decision, server lifecycle, and a v1 contract locked to
   pre-FTS `LIKE` semantics in one review.)
2. **Consolidation (separable)**: CitationService/ImportService wrap the existing
   dual-surface get/list/import ops; both existing handlers delegate. **Decided at
   review**: the MCP `import-bibtex` tool switches to the **full pipeline by
   default** (download + extract, matching the CLI) with an explicit metadata-only
   option — a deliberate behavior change for MCP clients, advertised in the updated
   tool description and streamed via the existing progress notifications.
3. **RetrievalService** wraps the download-pdf path (orchestrator invocation +
   logging currently inline in `src/mcp/tools/retrieval.ts` and the CLI command).
4. **Second surface**: CLI `search` command (reuse `CitationsTable`) + cross-surface
   parity tests.

## Proposed backlog items

Milestone 3 (adopted 2026-07-12):

- [search] M - Extract SearchService (src/services/search.ts) with shared zod contract; lexical mode over extended Database.searchCitations (see docs/plans/service-layer.md)
- [db] S - Extend Database.searchCitations: LIKE over journal/bibtex_key/doi + limit/cursor pagination reusing encodeCursor
- [mcp] M - MCP tool: search-citations over SearchService; trimmed result summaries (see docs/plans/service-layer.md)
- [mcp] M - MCP tool: read-content — serve extracted Markdown by DOI, paginated; manifestations lookup with stem fallback; section-addressed once chunks exist (see docs/plans/service-layer.md)
- [mcp] S - Generate MCP tool inputSchema from the shared zod contracts for all tools — removes hand-maintained JSON Schema blocks (see docs/plans/service-layer.md)
- [search] S - SearchService filters: year range, verification status, access type, has-pdf
- [test] S - SearchService unit tests + search-citations MCP handler tests
- [cli] M - `search` CLI command as second-surface adapter over SearchService + MCP/CLI parity test (see docs/plans/service-layer.md)
- [flow] M - CitationService/ImportService consolidation: MCP and CLI import delegate to one service; MCP import-bibtex gains full pipeline by default with a metadata-only option (see docs/plans/service-layer.md)

Supersedes/refines existing BACKLOG lines: `[cli] M - search CLI command…` and
`[mcp] M - MCP tool: search-citations…` (both rewritten in place, now bound to
SearchService; CLI sequenced after the MCP surface).

## Testing

- SearchService unit tests against a temp-file DB (pattern in
  `test/unit/db/database.test.ts`).
- MCP handler test asserting the contract (valid args, zod rejection shape, empty
  results, trimmed summary shape).
- inputSchema generation test: generated JSON Schema for each existing tool is
  behavior-compatible with the previous hand-written block.
- Cursor stability test (insert during pagination; no skips/dupes).
- From phase 4: parity test — same query through MCP handler and CLI produces
  identical result sets.

## Open questions

None remaining. Resolved at the 2026-07-12 review:

1. MCP result shape → **trimmed summary** (doi, title, year, journal, status +
   matchedFields); `get-citation` for detail.
2. inputSchema generation timing → **all six tools in phase 1** (not just the new
   tool), guarded by compatibility tests.
3. Import consolidation default → **full pipeline by default** on MCP, explicit
   metadata-only option; tool description updated to make the change visible.

## Relationship to other plans

- [fts5-full-text-search.md](fts5-full-text-search.md) — swaps SearchService
  internals from LIKE to FTS5; public contract unchanged.
- [http-api.md](http-api.md) — binds the same services as a later gateway; adds the
  HTTP column of the mapping table.
- [vector-hybrid-search.md](vector-hybrid-search.md) — widens `mode` union.
- [domain-model.md](domain-model.md) — orthogonal (schema); no dependency either way.
- [zotero-integration.md](zotero-integration.md) — its importer should reuse
  ImportService once phase 2 lands.
