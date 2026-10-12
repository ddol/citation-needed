# Web UI

| Field      | Value                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Status     | **Core: slices 4–8**                                                                                                                 |
| Flow       | Infrastructure (serves Dossier)                                                                                                      |
| Depends on | [http-api.md](http-api.md), [model-providers.md](model-providers.md), [indexing-jobs.md](indexing-jobs.md), [dossier.md](dossier.md) |

## Intent

A local web app for the dossier workflow: add a source, watch its dossier move
through stages, read the result with rendered math and per-item check marks,
and manage provider keys and role assignments. Built with SvelteKit and
svelte-ux, used the way their docs describe, and hosted by `citation-needed
serve` on loopback. It is the first surface for dossiers; MCP and CLI adapt the
same services later.

## Current state

- No HTTP server and no web assets. [http-api.md](http-api.md) sets the server
  conventions: port 4871, loopback bind, problem+json errors, the security
  rules.
- The project is CommonJS TypeScript compiled by `tsc`, tested by Jest, on Node
  20 in CI.
- Ink renders the one live terminal view (`ImportProgress`). `.tsx` means React
  and React means live redraw ([DESIGN.md](../../DESIGN.md)).

## Stack

| Piece      | Choice                                               | Why                                                                                                   |
| ---------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Framework  | SvelteKit 2 with `@sveltejs/adapter-node` 5          | svelte-ux's home; pages and API endpoints in one server; runs as a Node server, no static export      |
| Components | svelte-ux 2.0 prerelease, pinned to an exact version | Svelte 5 native and built on Tailwind 4; cards, fields, selects, tables, tabs, dialogs, notifications |
| Styling    | Tailwind 4 through `@tailwindcss/vite`               | svelte-ux is built on it, and it is what `npx sv add tailwindcss` installs                            |
| Math       | KaTeX                                                | the same library the LaTeX gate uses: one dependency, two uses                                        |
| Prose      | `marked` with a KaTeX extension                      | renders the Markdown fields of the dossier JSON                                                       |
| UI tests   | Playwright, already an optional dependency           | no second unit-test runner                                                                            |

**svelte-ux 2.0, not 1.x.** The `latest` tag (1.x) targets Tailwind 3 and Svelte
4 component syntax, so it fights SvelteKit's own Tailwind 4 setup and guarantees
a migration. The 2.0 line is where svelte-ux development happens; pinning an
exact prerelease keeps upgrades deliberate.

**SvelteKit 2, not 3.** SvelteKit 3 needs Node ≥ 22.17 and TypeScript 6, and
svelte-ux 2.0 is built and tested against SvelteKit 2. Move when svelte-ux does.

## Layout

```
web/                        SvelteKit app: ESM, an npm workspace
  src/hooks.server.ts       context into locals; Host and session checks
  src/routes/               pages (+page.svelte, +page.ts)
  src/routes/api/v1/        +server.ts endpoints: the HTTP gateway
  src/lib/components/       stage timeline, dossier view, Math.svelte
src/                        unchanged: services, CLI, MCP (CommonJS)
```

`web/` is an npm workspace with `"type": "module"`, because SvelteKit's config
is ESM while the CLI stays CommonJS. One `npm install` at the root installs
both. `npm run build` runs `tsc`, then `vite build` for `web/`; the published
package ships `web/build/`. Svelte compiles components, so the Vite build is
part of the normal build; nothing is exported as static HTML.

## Hosting

- **`serve` owns the process.** It calls `createAppContext()` once (database,
  services, worker loop, event bus), starts the worker, imports the adapter-node
  `handler` from `web/build/`, and serves it from a Node `http` server on
  loopback. Each request carries the context; adapter-node passes the Node
  request through as `event.platform.req`, and `hooks.server.ts` copies the
  context into `event.locals`.
- **One context per process.** Web code imports only _types_ from `src/`;
  services arrive through `locals`. Runtime service code bundled into the web
  build would open a second database handle and a second event bus, and SSE
  would never see the worker's events.
- **Development uses `vite dev`** with hot reload. With no `serve` process
  around it, `hooks.server.ts` creates the context itself through the same
  `createAppContext()`, in a dev-only branch the production build drops.

## Pages

| Page     | Path             | Shows                                                                                                                                                                                                                                                                                                              | Slice |
| -------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| Settings | `/settings`      | per provider: key status (env or file, masked hint), set, replace, delete, Ollama base URL, connection test; per role: model picker filled from the provider's model list, vision and independence warnings, whether input leaves the machine; token cap                                                           | 4     |
| Dossiers | `/`              | queue and history: source, tier, current stage, progress, flag count, tokens and cost; a new-dossier form taking a DOI, an arXiv id, or a library citation (PDF upload in slice 8)                                                                                                                                 | 5     |
| Progress | `/dossiers/{id}` | while running: stage timeline from acquire to render, per-stage item counters (math 9/14), a live model-run log (role, resolved model, tokens, duration), errors with retry, pause and resume, the disclosure prompt for a restricted source (confirm remote providers for this dossier, or switch to local roles) | 5     |
| Dossier  | `/dossiers/{id}` | when done: the rendered dossier with typeset math, each figure description beside its page-region image, ⚑ flags with reasons, the footer; download `.md` and `.json`                                                                                                                                              | 5, 6  |

## Rendering

- **Pages are Svelte components built from svelte-ux**, server-rendered and
  hydrated for the interactive parts: forms, pickers, dialogs, live progress.
  svelte-ux theming supplies light and dark.
- **Pages read through the API.** Each page's `load` calls
  `fetch('/api/v1/…')`; SvelteKit resolves same-app requests in-process during
  server rendering, so pages consume exactly the endpoints any other client
  sees. One HTTP gateway, not a page layer beside an API layer.
- **Live progress is Server-Sent Events.** The events endpoint returns a
  `ReadableStream` fed by the job event bus; a component subscribes with
  `EventSource`. A reload re-reads persisted state, so a refresh or a restarted
  server loses nothing.
- **Math is a `Math.svelte` component** calling `katex.renderToString`, which
  works during server rendering. Vite bundles KaTeX's CSS and fonts, so the UI
  works offline.
- **The dossier view renders from `<stem>.dossier.json`**, the same record the
  Markdown file is rendered from.

## Routes

`+server.ts` endpoints under `web/src/routes/api/v1/`. Each one parses its input
with the service's zod contract, calls the service from `locals`, and returns
JSON or problem+json. No endpoint holds logic.

| Route                                             | Purpose                                                                    | Slice |
| ------------------------------------------------- | -------------------------------------------------------------------------- | ----- |
| `GET /settings/providers`                         | key status (masked), base URL, last test result                            | 4     |
| `PUT /settings/providers/{id}/key`                | set or replace a key; write-only                                           | 4     |
| `DELETE /settings/providers/{id}/key`             | remove a stored key                                                        | 4     |
| `POST /settings/providers/{id}/test`              | list models and run a 1-token completion                                   | 4     |
| `GET /settings/providers/{id}/models`             | model list for the pickers, with vision and family                         | 4     |
| `GET /settings/roles`, `PUT /settings/roles`      | role assignments and limits, validated                                     | 4     |
| `POST /dossiers`                                  | create from a DOI, arXiv id, or citation id                                | 5     |
| `GET /dossiers`, `GET /dossiers/{id}`             | list; detail with parts, checks, and model runs                            | 5     |
| `GET /dossiers/{id}/events`                       | SSE: stage and item events                                                 | 5     |
| `POST /dossiers/{id}/cancel`, `/resume`, `/retry` | job control                                                                | 5     |
| `POST /dossiers/{id}/disclosure`                  | confirm remote providers for a restricted source, or switch roles to local | 5     |
| `GET /dossiers/{id}/regions/{key}.png`            | the page-region image behind an equation or figure                         | 6     |
| `POST /dossiers` (multipart)                      | upload a PDF; stored by sha256, deduplicated                               | 8     |

## Progress model

**One in-process event bus, written by the job worker.** Events:
`stage-started`, `item-finished` (part key and status), `model-run` (role,
resolved model, tokens, duration), `stage-finished`, `job-paused` (budget or disclosure),
`job-finished`. The SSE endpoint subscribes per dossier. The persisted rows
(`jobs`, `dossier_parts`, `model_runs`) are the source of truth on reload; the
bus only makes changes arrive sooner. `ImportProgress` can subscribe to the same
bus when imports become jobs.

## Security

The server stores keys and spends money, so it follows the local-server rules in
[http-api.md](http-api.md#security): `serve` binds loopback, and
`hooks.server.ts` enforces the `Host` allowlist and the `SameSite=Strict`
session cookie set by the startup token. SvelteKit's built-in origin check on
form submissions stays on. A key travels from the browser to the server once and
is never echoed back.

## Rejected alternatives

- **Server-rendered HTML templates without a client framework.** Smaller, but
  every interactive control (model pickers, dialogs, live tables) would be hand
  rolled. svelte-ux provides them.
- **hono beside SvelteKit.** Two HTTP frameworks in one process. SvelteKit
  endpoints carry the API, and the zod contracts already yield JSON Schema for
  OpenAPI.
- **A static SPA (`adapter-static`) behind a separate API server.** The API
  still needs a server; adapter-node makes it one process.
- **Vitest for component tests.** A second unit-test runner. Logic lives in
  services under Jest; Playwright covers the UI.
- **React and a React component library.** No advantage over the chosen stack,
  and `.tsx` would stop meaning live terminal redraw.
- **Polling or WebSockets.** Progress is one-way; SSE is the fit.
- **A desktop wrapper (Electron, Tauri).** Packaging cost; a browser tab is
  enough for a local tool.

## Phasing

1. **Slice 4**: `web/` workspace with Tailwind and svelte-ux, `serve` hosting
   with context injection and the security hooks, settings endpoints and page,
   Playwright smoke harness.
2. **Slice 5**: dossier endpoints, event bus and SSE, dossiers list, progress
   page, dossier view (text).
3. **Slice 6**: region images and typeset math in the view.
4. **Slice 7**: flag review: per-flag detail with source evidence, cost estimate
   on the new-dossier form.
5. **Slice 8**: PDF upload.

## Backlog items

- [ui] M - web/ SvelteKit 2 workspace: adapter-node, Tailwind 4, svelte-ux 2.0 pinned prerelease; svelte-check in typecheck; prettier-plugin-svelte and eslint-plugin-svelte; root build runs tsc then vite build (see docs/plans/web-ui.md)
- [api] M - serve hosts the adapter-node handler: createAppContext() once per process, context through platform.req into locals, worker started alongside; vite dev creates its own context (see docs/plans/web-ui.md)
- [test] M - Playwright smoke suite against a built server with a fixture database and a scripted provider: keys never echoed, foreign Host 403, missing cookie 401, settings round trip; extended each slice (see docs/plans/web-ui.md)
- [ui] M - Settings page: provider key status and set/replace/delete, Ollama base URL, connection test, role pickers with vision/independence warnings and data-leaves-machine indicator, token cap (see docs/plans/web-ui.md)
- [api] M - Settings endpoints: providers (masked status, write-only key, test, models) and roles (see docs/plans/web-ui.md)
- [api] M - Dossier endpoints: create, list, detail, cancel/resume/retry, disclosure; SSE events from the job event bus (see docs/plans/web-ui.md)
- [ui] M - Dossiers list and progress page: stage timeline, item counters, live model-run log, errors with retry, disclosure prompt for restricted sources (see docs/plans/web-ui.md)
- [ui] M - Dossier view rendered from the dossier JSON: flags with reasons, footer, .md/.json download (see docs/plans/web-ui.md)
- [ui] S - Math.svelte (KaTeX, server-rendered) and page-region images beside equations and figures (see docs/plans/web-ui.md)
- [ui] S - Flag review: per-flag detail with source evidence; cost estimate on the new-dossier form (see docs/plans/web-ui.md)
- [ui] S - PDF upload on the new-dossier form, stored by sha256 (see docs/plans/web-ui.md)

## Testing

- **Logic lives in services and is tested in Jest** under the coverage ratchet.
  Endpoints and pages hold none, which is what lets `web/` sit outside the
  ratchet the way `eval/` does.
- **Playwright smoke suite** against a built `serve` with a fixture database and
  a scripted provider. Request checks (no browser): the key lifecycle, a scan of
  every settings response for the key value, problem+json shapes, foreign `Host`
  403, missing session cookie 401. Page checks: the settings round trip, SSE
  progress reaching `done` for a scripted job, typeset math and flag reasons in
  a fixture dossier.
- `svelte-check` runs with `npm run typecheck`.

## Open questions

1. Expose the wider library (citation list, `.bib` import) in the UI, or stay
   dossier-only? Default: dossier-only, plus a library search box over
   `SearchService` on the new-dossier form.

## Relationship to other plans

- [http-api.md](http-api.md): conventions, endpoint validation, security.
- [model-providers.md](model-providers.md): the services behind the settings
  page.
- [indexing-jobs.md](indexing-jobs.md): job state and the events progress
  reads.
- [dossier.md](dossier.md): what the dossier view renders.
