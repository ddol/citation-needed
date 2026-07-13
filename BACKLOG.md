# citation-needed — Backlog

Anti-hallucination academic citation assistant: BibTeX → local PDFs + Markdown, with SQLite tracking and MCP server.

**Sizes:** XS < 1 h · S 1–4 h · M half–full day · L 2–3 d · XL week+
**Tags:** [fetch] [flow] [parse] [db] [cli] [mcp] [tui] [verify] [test] [auth] [deploy] [docs] [devx] [util] [cfg] [search] [valid] [api] [storage]

**Work-streams** (product view, adopted 2026-07-12 — one stream per item, "serves X" notes where it enables another):

- **A — Grounded Answers**: on the agent's find → read → cite path via MCP
- **B — Trust & Verification**: lets a claim or the corpus's state be checked
- **C — Coverage & Acquisition**: raises the fraction of relevant papers present and readable
- **D — Researcher Workflow**: fits existing human workflows and frontends
- **E — Platform & Scale**: foundations the other streams stand on

**Priorities:** P0 blocks the core agent loop · P1 trust multiplier / major friction remover · P2 coverage & enablers · P3 polish/ops.
Execution focus order: A/E-P0 → A/B-P1 → P2 (D before C where independent) → P3. Technical dependencies in [docs/plans/](docs/plans/README.md) still gate sequencing.

_Streams replaced the former Milestones 2–6 on 2026-07-12; "Milestone" labels inside docs/plans/ refer to those pre-restructure sections. Milestone 1 is kept below as history._

---

## Milestone 1 — Cleanup

Tech debt, testing gaps, DX, docs, validation, minor code-quality fixes.

_All Milestone 1 tasks are complete — see [Completed](#completed)._

---

## Stream A — Grounded Answers

The agent's core loop via MCP: find → read → cite with provenance. (docs/plans/service-layer.md, docs/plans/fts5-full-text-search.md)

### P0 — blocks the agent loop

- [search] M - Extract SearchService (src/services/search.ts) with shared zod contract; lexical mode over extended Database.searchCitations (see docs/plans/service-layer.md)
- [db] S - Extend Database.searchCitations: LIKE over journal/bibtex_key/doi + limit/cursor pagination reusing encodeCursor
- [mcp] M - MCP tool: search-citations over SearchService; trimmed result summaries (see docs/plans/service-layer.md)
- [mcp] M - MCP tool: read-content — serve extracted Markdown by DOI, paginated; manifestations lookup with stem fallback; section-addressed once chunks exist (see docs/plans/service-layer.md)
- [mcp] S - Generate MCP tool inputSchema from the shared zod contracts for all tools — removes hand-maintained JSON Schema blocks (see docs/plans/service-layer.md)
- [test] S - SearchService unit tests + search-citations MCP handler tests
- [db] S - Spike: assert FTS5 available in bundled better-sqlite3 (CREATE VIRTUAL TABLE smoke test in CI, macOS ARM64 + Linux)
- [verify] S - Heading-based Markdown chunker: sectionPath from heading trail, ~2000-char max split; runs after markdown post-processing (see docs/plans/fts5-full-text-search.md)
- [db] M - chunks table (citation_id, manifestation_id, ordinal, section_path, text, content_hash) via migration runner
- [search] M - External-content FTS5 tables (chunks_fts, citations_fts; porter unicode61) with sync triggers (see docs/plans/fts5-full-text-search.md)
- [search] M - SearchService lexical mode on FTS5: bm25 ranking, snippet() highlights, section provenance; LIKE fallback pre-index
- [cli] S - `index` CLI command: one-shot (re)index into chunks + FTS; idempotent by content_hash; eager re-chunk on chunker version bump

### P1

- [search] S - SearchService filters: year range, verification status, access type, has-pdf
- [verify] M - Markdown post-processing: remove artefact lines, normalise headings (runs before FTS chunking — see docs/plans/fts5-full-text-search.md; serves B)
- [test] S - Search fixture corpus + golden-query tests (phrase, stemming, unicode, section scope, filters)

_Deferred (stream A future): semantic + hybrid search modes — parked in docs/plans/vector-hybrid-search.md until FTS5 quality is observed on a real corpus._

---

## Stream B — Trust & Verification

Anti-hallucination: claims and corpus state are checkable — the product's namesake. (docs/plans/fts5-full-text-search.md § verify-quote, docs/plans/storage-adapters.md)

### P1

- [mcp] M - MCP tool: verify-quote — normalize a quoted passage, exact-match against chunks then FTS fuzzy fallback; return section provenance or closest miss (see docs/plans/fts5-full-text-search.md)
- [cli] M - `verify` CLI command: re-check all citations and update verification status (doubles as manifestation location health check — see docs/plans/storage-adapters.md)
- [verify] S - Quality metrics for extracted Markdown (word count, section count, table detection; doubles as chunker input validation)

### P2

- [mcp] S - MCP tool: get-retrieval-log (download attempt history for a DOI)
- [cli] XS - `stats` CLI command: citation status summary and database size
- [storage] S - Availability checks: last_seen_at refresh, unavailable status surfaced in search results and `verify` CLI (see docs/plans/storage-adapters.md)

---

## Stream C — Coverage & Acquisition

More relevant papers present and readable.

### P2

- [fetch] L - Semantic Scholar API resolver for open-access links and citation graph (citation graph = related-papers discovery; serves A)
- [fetch] M - Metadata enrichment from Crossref: abstract, keywords, licence, ISSN (abstract unlocks abstract search; serves A)
- [fetch] L - Implement Springer Link PDF resolution via publisher adapter
- [fetch] L - Implement Elsevier ScienceDirect PDF resolution via publisher adapter
- [fetch] L - Implement ACM Digital Library PDF resolution via publisher adapter
- [fetch] L - PubMed/NCBI E-utilities resolver for life-sciences papers
- [fetch] M - Wire publisher adapters into RetrievalOrchestrator fallback chain
- [fetch] M - Exponential backoff retry for failed HTTP download attempts
- [auth] M - API key management for publisher APIs (Elsevier, Springer)
- [verify] XL - OCR fallback for scanned PDFs (tesseract.js or external API) — future extract-stage variant (see docs/plans/indexing-jobs.md)
- [verify] L - Reference list extraction from extracted Markdown (cited-papers discovery; serves A)

### P3

- [fetch] S - DoiResolver: populate isOpenAccess field — currently always undefined
- [auth] XL - SAML/Shibboleth SSO authentication for institutional access
- [auth] M - Proxy rotation across multiple configured institutional proxies — currently only proxies[0] used

---

## Stream D — Researcher Workflow

Fits how researchers and their frontends already work. (docs/plans/zotero-integration.md, docs/plans/http-api.md)

### P1

- [parse] M - Zotero JSON export import: metadata + capture item key, library id, tags, collections, attachment paths (see docs/plans/zotero-integration.md)
- [docs] S - Document Better BibTeX auto-export (pinned keys, file field) as the zero-code Zotero → citation-needed path (see docs/plans/zotero-integration.md)
- [flow] M - Link Zotero storage and linked-file attachment PDFs as manifestations instead of re-downloading (see docs/plans/zotero-integration.md)

### P2

- [cli] M - `search` CLI command as second-surface adapter over SearchService + MCP/CLI parity test (see docs/plans/service-layer.md)
- [parse] S - Opt-in --update import mode: gap-fill null fields, overwrite only non-protected fields, report changes (see docs/plans/zotero-integration.md)
- [parse] M - RIS reference format import (.ris files)
- [cli] M - `export` CLI command: write BibTeX/RIS/JSON from database
- [cli] S - `update` CLI command: re-download or refresh metadata for a single citation
- [mcp] S - MCP tool: update-citation metadata
- [db] S - Store Zotero item key + library id in identifiers table on import
- [db] M - tags + collections join tables populated from Zotero import; SearchService and API filters (see docs/plans/zotero-integration.md)
- [search] S - Emit zotero://select links in search/MCP/API results when item key known (verify supported URL forms first)
- [api] M - Add hono + @hono/node-server + @hono/zod-openapi; `serve` CLI command (--port default 4871, loopback default) (see docs/plans/http-api.md)
- [api] M - GET /api/v1/health, /capabilities, /citations (cursor pagination), /citations/{doi}
- [api] M - POST /api/v1/search bound to SearchService via the shared zod contract
- [api] M - OpenAPI: serve /api/v1/openapi.json generated from route schemas; emit openapi/citation-needed-v1.yaml as build artifact
- [api] S - RFC 7807 problem+json error responses; static bearer-token auth (required for non-loopback binds) + request logging
- [test] M - HTTP integration tests: routes, problem+json shapes, MCP/HTTP search parity
- [docs] S - docs/http-api.md usage reference
- [flow] L - `watch` mode as filesystem-watcher job producer: monitor a directory for new .bib files and auto-import (see docs/plans/indexing-jobs.md)

### P3

- [parse] S - CSV metadata import (title + DOI columns)
- [mcp] S - MCP tool: delete-citation
- [flow] L - Zotero 7 local HTTP API import (localhost:23119) with incremental pull
- [flow] M - Webhook notification on batch import completion (configurable URL)
- [tui] S - ImportProgress reads the jobs table for progress — survives restarts, shows watch-mode work (see docs/plans/indexing-jobs.md)
- [tui] L - Interactive TUI: multi-select bulk operations (delete, re-download)
- [tui] M - Interactive TUI: paginated, sortable, filterable citations table
- [tui] M - Interactive TUI: live per-citation download progress bars

---

## Stream E — Platform & Scale

Foundations the other streams stand on. (docs/plans/domain-model.md, docs/plans/indexing-jobs.md, docs/plans/storage-adapters.md)

### P0 — prerequisites for the A-stream chain

- [db] M - Versioned migration runner (PRAGMA user_version + ordered steps in src/db/migrations.ts); existing ad-hoc migrators become bootstrap (see docs/plans/domain-model.md)
- [db] M - manifestations table as single source of truth for files; Database class derives Citation.pdfPath; pdf_path dormant after one transition release (see docs/plans/domain-model.md)
- [db] S - Backfill manifestations from existing pdf_path values and papers/markdown/ stems
- [util] S - Streaming sha256 content-hash helper; hash PDFs and Markdown at write time (see docs/plans/domain-model.md)

### P1

- [flow] M - CitationService/ImportService consolidation: MCP and CLI import delegate to one service; MCP import-bibtex gains full pipeline by default with a metadata-only option (see docs/plans/service-layer.md; serves A, D)

### P2

- [db] M - identifiers table (scheme+value UNIQUE: arxiv, pmid, zotero-key, zotero-library, bibtex-key); DOI stays on citations (see docs/plans/domain-model.md; serves D)
- [db] M - Admit DOI-less citations: relax import guards; identity via identifiers + generated internal id (see docs/plans/domain-model.md; serves C, D)
- [db] M - Citation deduplication via fuzzy title matching before insert — consult identifiers table once available (see docs/plans/domain-model.md)
- [db] S - Database backup and restore commands
- [flow] M - jobs table (kind, payload, status, attempts, last_error) + in-process worker loop; per-entry jobs with batch_id; 3 auto-retries with backoff then manual (see docs/plans/indexing-jobs.md)
- [flow] M - Stage-based pipeline (resolve → download → extract → chunk → fts-index) with per-stage provenance on manifestations/chunks (see docs/plans/indexing-jobs.md)
- [flow] S - Incremental re-index rules: skip unchanged content_hash; extractor/chunker version bump invalidates downstream stages only
- [flow] L - Concurrent PDF downloads via job worker pool with configurable concurrency limit (see docs/plans/indexing-jobs.md; serves C)
- [flow] M - Resume interrupted imports via persisted job state (see docs/plans/indexing-jobs.md)
- [cli] S - `jobs` CLI command: list, status, retry failed
- [test] M - Crash-resume and idempotency tests: kill worker mid-batch → restart completes without re-downloading; rerun produces zero new work
- [test] S - FTS benchmark script: index size and query latency at 1k/10k docs, with a size-per-document budget (see docs/plans/fts5-full-text-search.md; serves A)
- [storage] M - StorageAdapter interface + LocalFileAdapter; route all PDF/markdown reads through it (see docs/plans/storage-adapters.md)
- [db] S - Normalize manifestation paths to file:// URIs (migration + write-path change)
- [cfg] M - Persistent config file (~/.citation-needed/config.json) for default flags (consumed by HTTP API port/token — see docs/plans/http-api.md)
- [deploy] M - npm publish pipeline and versioned GitHub Releases

### P3

- [deploy] L - Docker container image and Compose file for server mode (also serves the HTTP API — see docs/plans/http-api.md)
- [deploy] S - Systemd service unit file for persistent MCP server daemon (and the `serve` HTTP daemon — see docs/plans/http-api.md)

---

## Completed

- [test] L - Add tests for all CLI commands (import, list, download, auth, server)
- [test] M - Add tests for OpenAccessDownloader
- [test] M - Add tests for AuthenticatedDownloader
- [test] M - Add tests for RetrievalOrchestrator integration paths
- [test] S - Add tests for auth config load/save
- [test] S - Add tests for DoiResolver
- [test] S - Add tests for publisher adapter URL helpers (Springer, Elsevier, ACM)
- [test] S - Add tests for PDF Markdown extraction (extractPdfMarkdown)
- [test] S - Add tests for CitationsTable TUI component
- [test] S - Expand MCP server tests beyond basic tool registration
- [test] XS - Add tests for getCitationFileStem / getCitationDisplayName
- [test] XS - Set jest coverageThreshold so CI fails below acceptable coverage
- [devx] S - Add ESLint with TypeScript rules
- [devx] S - Add Prettier with pre-commit hook
- [devx] S - Enable TypeScript strict mode (noImplicitAny, noUnusedLocals, noImplicitReturns)
- [devx] XS - Read version from package.json at runtime — remove 4 hardcoded "0.1.0" strings
- [devx] XS - Remove ignoreDeprecations: "5.0" from tsconfig and fix root cause
- [devx] XS - Add pretest type-check step to package.json scripts
- [devx] XS - Add test:coverage script with threshold enforcement
- [fetch] S - ArxivResolver, UnpaywallResolver, DoiResolver silently swallow errors — log and propagate message
- [fetch] S - Surface RetrievalOrchestrator warning logs into RetrievalResult.message
- [fetch] XS - Remove deprecated ArxivRetriever and UnpaywallRetriever re-exports
- [fetch] XS - Remove dead publisher getAdapter() import in orchestrator or wire it up
- [fetch] XS - Move hardcoded resolver timeouts (15 000 ms) and rate limit (1 000 ms) to config constants
- [fetch] XS - Fix User-Agent in doi.ts and open-access.ts: read version from package.json, email from auth config
- [db] S - Add indexes on doi and created_at columns
- [db] S - Wrap processBibtexFile in a DB transaction — partial failure currently leaves DB inconsistent
- [db] XS - Add CASCADE DELETE on retrieval_log foreign key to prevent orphaned rows
- [db] XS - Add CHECK constraints on verification_status and access_type enum columns
- [mcp] S - Add schema validation for MCP tool arguments — remove unsafe type casts
- [mcp] S - Stream progress events from import-bibtex MCP tool during processing
- [mcp] S - Add cursor-based pagination to list-citations MCP tool
- [flow] S - Persist batch import failures to DB so they form an audit log
- [flow] S - Report skipped entries (no DOI) in processBibtexFile output
- [tui] XS - Colour-code citation status in CitationsTable
- [tui] XS - Make CitationsTable column widths adaptive rather than hardcoded
- [valid] XS - Validate email format before storing in auth config
- [valid] XS - Validate DOI format before database insert
- [docs] XS - Add .env.example file
- [docs] XS - Fix README output directory examples to match actual defaults (papers/pdf/, papers/markdown/)

- [fetch] L - (5) AuthenticatedDownloader — Playwright browser automation for proxy-gated content
- [fetch] M - RetrievalOrchestrator — coordinated cascade: cache → Unpaywall → arXiv → authenticated
- [fetch] M - OpenAccessDownloader — HTTP PDF download with rate limiting and local cache check
- [fetch] M - ArxivResolver — title-based Atom XML search with retry for rate limits
- [fetch] M - UnpaywallResolver — open-access PDF URL discovery via Unpaywall API
- [fetch] M - DoiResolver — Crossref metadata lookup (title, authors, year, journal, publisher)
- [fetch] S - Stubbed publisher URL adapters: Springer, Elsevier, ACM (landing page URL only)
- [flow] M - (5) processBibtexFile workflow with per-entry onProgress callbacks and failure tracking
- [parse] S - BibTeX file parsing via bibtex-parse library
- [parse] S - DOI parsing, normalization, and extraction from URLs
- [parse] S - URL classification (arxiv/doi/pubmed/pdf/html/unknown)
- [db] M - SQLite database via better-sqlite3 with migration support
- [db] S - Citation CRUD with UPSERT-on-DOI semantics
- [db] S - Retrieval attempt logging table (source, url, success, duration_ms)
- [db] S - Full-text search on title/authors in DB layer
- [cli] M - CLI command: import-bibtex with --paper-path, --markdown-path, --email flags
- [cli] S - CLI command: download single PDF by DOI with optional --url and --email
- [cli] S - CLI command: list — Ink/React table view of all stored citations
- [cli] S - CLI command: auth add-proxy with --login-url, --username, --password-env
- [cli] XS - CLI command: auth set-email — stores email in ~/.citation-needed/auth.json
- [cli] XS - CLI command: auth show — masked display of current auth config
- [cli] XS - CLI command: server — start MCP server on stdio transport
- [mcp] S - MCP tool: get-citation — fetch citation metadata by DOI
- [mcp] S - MCP tool: list-citations — return all stored citations
- [mcp] S - MCP tool: import-bibtex — import citations from BibTeX string
- [mcp] S - MCP tool: search-arxiv — search arXiv by paper title
- [mcp] S - MCP tool: download-pdf — trigger PDF download by DOI
- [tui] M - (5) ImportProgress Ink/React component — real-time per-citation import progress
- [tui] S - CitationsTable Ink/React component — static 4-column table (DOI, title, year, status)
- [verify] M - PDF-to-Markdown extraction via @opendocsg/pdf2md
- [auth] S - Auth config file management (~/.citation-needed/auth.json, never stores passwords)
- [util] S - Logger utility with debug/info/warn/error/silent levels
- [util] S - RateLimiter utility with configurable interval for request throttling
- [util] XS - (5) getCitationFileStem / getCitationDisplayName file-naming helpers
- [cfg] S - Environment variable configuration for DB path, PDF dir, email
