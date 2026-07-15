# HTTP Search API & OpenAPI

| Field         | Value                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Status        | **Exploratory** — build when a real non-MCP client appears                                                                                  |
| Flow          | Infrastructure (frontend enabler)                                                                                                           |
| Depends on    | [service-layer.md](service-layer.md) (hard); [fts5-full-text-search.md](fts5-full-text-search.md) (soft — more valuable after, not blocked) |
| Last reviewed | 2026-07-12                                                                                                                                  |

## Intent

A small, versioned HTTP API so non-MCP clients (web UI, Zotero plugin, scripts,
other languages) can search and read the corpus. Per the unified-surface
principle ([service-layer.md](service-layer.md)), HTTP is a **thin gateway**
over the same services and zod contracts — never a second implementation. The
core `/search` endpoint stays deterministic and LLM-free.

## Current state

- **No HTTP server of any kind exists.** The only transport is MCP over stdio
  (`StdioServerTransport`, `src/mcp/server.ts`). The `server` CLI command starts
  that stdio server — the command name is taken.
- `hono` appears in `node_modules` only as a **transitive dependency** of
  `@modelcontextprotocol/sdk`; it is not in `package.json` and nothing imports it.
  Any HTTP framework is a new direct dependency regardless.
- `zod ^4.4.3` is already a direct dependency, used for MCP arg validation.
- No OpenAPI spec, no `openapi/` directory.

## Design

### Framework: hono + @hono/node-server + @hono/zod-openapi

The transitive presence of hono is **irrelevant** to the decision (it must
become a direct dependency either way). The real reasons:

1. **zod-first**: `@hono/zod-openapi` derives the OpenAPI spec from the same
   zod schemas the service layer already defines — one contract source, no
   hand-maintained YAML, no drift.
2. Tiny footprint fits a local-first tool; TS-first typing.

Runners-up, recorded: **fastify** (solid, but JSON-Schema-native — fights the
zod investment through a conversion bridge); **express** (weakest typing, no
spec story).

### v1 endpoints

| Endpoint                      | Notes                                                    |
| ----------------------------- | -------------------------------------------------------- |
| `GET /api/v1/health`          | liveness + schema version                                |
| `GET /api/v1/capabilities`    | static JSON reflecting the actual build (see below)      |
| `GET /api/v1/citations`       | cursor pagination — same `encodeCursor` semantics as MCP |
| `GET /api/v1/citations/{doi}` | single lookup                                            |
| `POST /api/v1/search`         | body = SearchService request contract, verbatim          |

The resource is named **citations**, not documents — it mirrors the actual
schema; [domain-model.md](domain-model.md) rejects the rename.

```json
// GET /api/v1/capabilities
{
  "fullTextSearch": false,
  "vectorSearch": false,
  "storageAdapters": ["file"]
}
```

Deferred endpoints, each blocked on its plan: `/citations/{doi}/content` →
[service-layer.md](service-layer.md) read-content (HTTP binding of the same
ContentService); `/citations/{doi}/chunks` →
[fts5-full-text-search.md](fts5-full-text-search.md); `/citations/{doi}/links` →
[storage-adapters.md](storage-adapters.md); `/collections`, `/tags` →
[zotero-integration.md](zotero-integration.md); `POST /index/*`, `/jobs/*` →
[indexing-jobs.md](indexing-jobs.md).

### Server lifecycle

New `serve` CLI command (`server` is taken by MCP stdio):

```
citation-needed serve --port 4871 --host 127.0.0.1
```

Loopback bind by default. Optional static bearer token via
`CITATION_NEEDED_API_TOKEN`, required automatically for non-loopback binds. Not
multi-tenant, no user accounts. Port/host move into the persistent config file
when that lands; env vars suffice until then.

### OpenAPI

The spec is **generated from the route zod schemas**, served live at
`GET /api/v1/openapi.json`; the YAML file is a build artifact emitted by a
script for client generation (TypeScript first; Python/Rust/Rails from the same
file). No hand-written spec.

### Errors: RFC 7807 problem+json

Responses use `application/problem+json`: `type`, `title`, `status`, `detail`,
plus an `issues` extension member carrying zod issues on validation failures.

```json
{
  "type": "https://citation-needed.dev/problems/invalid-request",
  "title": "Invalid request",
  "status": 400,
  "detail": "query must not be empty",
  "issues": [{ "path": ["query"], "message": "String must contain at least 1 character(s)" }]
}
```

404 for unknown DOI; 401 for missing/bad token — same media type throughout.

### Rejected / deferred alternatives

- **LLM endpoints** (`/answer`, `/summarize`, `/classify`, `/compare`): outside
  the deterministic core and the only endpoints that would need API keys.
- **Client storage-mapping request context**: the v1 client is on the same
  machine; overbuild.
- **Capability negotiation**: a static capabilities JSON suffices.
- **Serving MCP over HTTP/SSE**: separate concern; revisit if a remote MCP
  client appears.
- **Ad-hoc error envelope**: RFC 7807 instead.

## Phasing

1. **Skeleton**: hono deps, `serve` command, `/health` + `/capabilities`,
   integration-test harness (in-process app, no port binding).
2. **Data routes**: `/citations`, `/citations/{doi}`, `POST /search` bound to
   SearchService; parity test vs MCP.
3. **Spec + docs**: `/api/v1/openapi.json`, YAML build artifact, usage doc.

## Backlog items (all exploratory)

- [api] M - Add hono + @hono/node-server + @hono/zod-openapi; `serve` CLI command (--port default 4871, loopback default) (see docs/plans/http-api.md)
- [api] M - GET /api/v1/health, /capabilities, /citations (cursor pagination), /citations/{doi}
- [api] M - POST /api/v1/search bound to SearchService via the shared zod contract
- [api] M - OpenAPI: serve /api/v1/openapi.json generated from route schemas; emit openapi/citation-needed-v1.yaml as build artifact
- [api] S - RFC 7807 problem+json error responses; static bearer-token auth (required for non-loopback binds) + request logging
- [test] M - HTTP integration tests: routes, problem+json shapes, MCP/HTTP search parity
- [docs] S - docs/http-api.md usage reference

## Testing

- Route integration tests with an injected app instance (hono's
  `app.request()`), no real port.
- Error-shape tests: problem+json 400 with zod issues, 404, 401 with/without
  token — `content-type: application/problem+json` asserted.
- **Flagship parity test**: the same search request through the MCP handler and
  `POST /api/v1/search` returns identical result sets (both are thin bindings
  of SearchService).
- Capabilities truthfulness: response matches actual build state (e.g.
  `fullTextSearch` flips only when FTS tables exist).

## Open questions

1. Should `serve` also host a minimal static search page later, or does the
   web UI stay a separate artifact? (Deferred until a web UI is actually
   wanted.)

## Relationship to other plans

- [service-layer.md](service-layer.md) — provides the services and zod
  contracts; this plan owns the HTTP column of the operation mapping table.
- [fts5-full-text-search.md](fts5-full-text-search.md) — flips the
  `fullTextSearch` capability; snippets flow through `/search` unchanged.
- [storage-adapters.md](storage-adapters.md) — later adds
  `/citations/{doi}/links`.
- [zotero-integration.md](zotero-integration.md) — a Zotero plugin / web UI
  would consume this API.
- [vector-hybrid-search.md](vector-hybrid-search.md) — flips the `vectorSearch`
  capability; adds modes to the same `/search` contract.
