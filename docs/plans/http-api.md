# HTTP API & OpenAPI

| Field      | Value                                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Status     | **Core: slice 4** for the server, conventions, and security rules the web UI needs; the citation, search, and OpenAPI routes stay exploratory |
| Flow       | Infrastructure (serves Dossier)                                                                                                               |
| Depends on | [service-layer.md](service-layer.md) (hard); [fts5-full-text-search.md](fts5-full-text-search.md) (soft; more valuable after, not blocked)    |

## Intent

A small, versioned HTTP API so non-MCP clients can reach the same services the
MCP tools use. The first client is the dossier web UI ([web-ui.md](web-ui.md)),
which needs settings and dossier routes; a Zotero plugin, scripts, and other
languages follow through the citation and search routes. Per the
unified-surface principle ([service-layer.md](service-layer.md)), HTTP is a
**thin gateway** over the same services and zod contracts: never a second
implementation. The `/search` endpoint stays deterministic.

## Current state

- **No HTTP server of any kind exists.** The only transport is MCP over stdio
  (`StdioServerTransport`, `src/mcp/server.ts`). The `server` CLI command starts
  that stdio server: the command name is taken.
- `zod ^4.4.3` is already a direct dependency, used for MCP arg validation.
- No OpenAPI spec, no `openapi/` directory.

## Design

### Framework: SvelteKit endpoints

The web UI runs on SvelteKit with adapter-node ([web-ui.md](web-ui.md)), so the
API is SvelteKit `+server.ts` endpoints under `web/src/routes/api/v1/`, served
by the same process. One HTTP framework, not two side by side.

- **zod-first.** Each endpoint parses its input with the service's zod
  contract through one shared helper that turns a failed parse into a
  problem+json 400. The contracts stay the single source of truth.
- **OpenAPI from the contracts.** A build script assembles the spec from the
  endpoint table and `z.toJSONSchema` (zod v4): no framework-specific spec
  generator, no hand-maintained YAML.
- **No logic in endpoints.** Parse, call the service from `event.locals`,
  format. Behaviour is tested at the service.

Runners-up, recorded: **hono with `@hono/zod-openapi`** (the right choice when
the API was the only HTTP surface; beside SvelteKit it is a second framework in
one process); **fastify** (JSON-Schema-native, fighting the zod investment);
**express** (weakest typing, no spec story).

### v1 endpoints

| Endpoint                      | Notes                                                   |
| ----------------------------- | ------------------------------------------------------- |
| `GET /api/v1/health`          | liveness + schema version                               |
| `GET /api/v1/capabilities`    | static JSON reflecting the actual build (see below)     |
| `GET /api/v1/citations`       | cursor pagination; same `encodeCursor` semantics as MCP |
| `GET /api/v1/citations/{doi}` | single lookup                                           |
| `POST /api/v1/search`         | body = SearchService request contract, verbatim         |

The resource is named **citations**, not documents: it mirrors the actual
schema; [domain-model.md](domain-model.md) rejects the rename.

```json
// GET /api/v1/capabilities
{
  "fullTextSearch": false,
  "vectorSearch": false,
  "storageAdapters": ["file"]
}
```

The settings and dossier routes are specified in [web-ui.md](web-ui.md) and
follow every convention here. Deferred endpoints, each blocked on its plan: `/citations/{doi}/content` →
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

Loopback bind by default. `serve` creates the app context once, starts the job
worker loop ([indexing-jobs.md](indexing-jobs.md)), and mounts the SvelteKit
adapter-node handler in a Node `http` server ([web-ui.md](web-ui.md#hosting)). Not multi-tenant, no
user accounts. Port and host live in the persistent config file
([model-providers.md](model-providers.md)), with env vars overriding.

### Security

**A loopback server is still reachable from every page the user's browser
loads.** This one stores API keys and starts jobs that spend money, so:

`serve` enforces the bind; `hooks.server.ts` enforces the rest on every request.

- **Loopback bind.** A non-loopback bind is refused unless
  `CITATION_NEEDED_API_TOKEN` is set, and then every request needs it as a
  bearer token.
- **Host allowlist.** Requests whose `Host` is not `127.0.0.1:<port>` or
  `localhost:<port>` get 403. This defeats DNS rebinding, where a hostile domain
  re-resolves to 127.0.0.1.
- **Startup token, session cookie.** `serve` prints a URL carrying a random
  token (the Jupyter pattern). Visiting it sets an `HttpOnly`, `SameSite=Strict`
  session cookie; every `/api` route and page requires it. A cross-site form or
  fetch never carries a strict cookie, which defeats CSRF without per-form
  tokens.
- **No CORS headers**, ever.
- **Secrets never in responses.** Key status is reported masked
  ([model-providers.md](model-providers.md)).

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

404 for unknown DOI; 401 for missing/bad token; same media type throughout.

### Rejected / deferred alternatives

- **Free-form LLM endpoints** (`/answer`, `/summarize`, `/compare`): the
  dossier is the one generated artifact, produced by a job with checks and
  provenance. Ad-hoc generation endpoints would bypass both.
- **Client storage-mapping request context**: the v1 client is on the same
  machine; overbuild.
- **Capability negotiation**: a static capabilities JSON suffices.
- **Serving MCP over HTTP/SSE**: separate concern; revisit if a remote MCP
  client appears.
- **Ad-hoc error envelope**: RFC 7807 instead.

## Phasing

1. **Core, slice 4**: `serve` hosting the SvelteKit handler, the security
   rules, `/health`, the problem+json helper; then the settings endpoints from
   [web-ui.md](web-ui.md).
2. **Core, slice 5**: the dossier routes from [web-ui.md](web-ui.md).
3. **Data routes**: `/capabilities`, `/citations`, `/citations/{doi}`,
   `POST /search` bound to SearchService; parity test vs MCP.
4. **Spec + docs**: `/api/v1/openapi.json`, YAML build artifact, usage doc.

## Backlog items

Core (slice 4):

- [api] M - Server security: loopback bind in serve; Host allowlist, startup token exchanged for a SameSite=Strict session cookie, bearer token for non-loopback binds, no CORS in hooks.server.ts (see docs/plans/http-api.md)
- [api] S - GET /api/v1/health; shared zod-parse helper returning RFC 7807 problem+json; request logging with key redaction (see docs/plans/http-api.md)

The `serve` hosting item lives in [web-ui.md](web-ui.md).

Exploratory:

- [api] M - GET /api/v1/capabilities, /citations (cursor pagination), /citations/{doi}
- [api] M - POST /api/v1/search bound to SearchService via the shared zod contract
- [api] M - OpenAPI: serve /api/v1/openapi.json assembled from the endpoint table and z.toJSONSchema; emit openapi/citation-needed-v1.yaml as build artifact
- [test] M - HTTP integration tests: citation routes, MCP/HTTP search parity
- [docs] S - docs/http-api.md usage reference

## Testing

- Endpoint behaviour is service behaviour, tested in Jest. HTTP-level checks
  run as Playwright request tests (no browser) against a built `serve`.
- Error-shape tests: problem+json 400 with zod issues, 404, 401 with/without
  token, with `content-type: application/problem+json` asserted.
- Security: a foreign `Host` gets 403; a request without the session cookie
  gets 401; the startup token sets a `SameSite=Strict` cookie; a non-loopback
  bind without `CITATION_NEEDED_API_TOKEN` refuses to start; no response carries
  CORS headers.
- **Flagship parity test**: the same search request through the MCP handler and
  `POST /api/v1/search` returns identical result sets (both are thin bindings
  of SearchService).
- Capabilities truthfulness: response matches actual build state (e.g.
  `fullTextSearch` flips only when FTS tables exist).

## Open questions

None currently.

## Relationship to other plans

- [service-layer.md](service-layer.md): provides the services and zod
  contracts; this plan owns the HTTP column of the operation mapping table.
- [fts5-full-text-search.md](fts5-full-text-search.md): flips the
  `fullTextSearch` capability; snippets flow through `/search` unchanged.
- [storage-adapters.md](storage-adapters.md): later adds
  `/citations/{doi}/links`.
- [web-ui.md](web-ui.md): the first client; owns the settings and dossier
  routes.
- [zotero-integration.md](zotero-integration.md): a Zotero plugin would
  consume this API.
- [vector-hybrid-search.md](vector-hybrid-search.md): flips the `vectorSearch`
  capability; adds modes to the same `/search` contract.
