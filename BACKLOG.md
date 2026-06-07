# citation-needed — Backlog

Anti-hallucination academic citation assistant: BibTeX → local PDFs + Markdown, with SQLite tracking and MCP server.

**Sizes:** XS < 1 h · S 1–4 h · M half–full day · L 2–3 d · XL week+
**Tags:** [fetch] [flow] [parse] [db] [cli] [mcp] [tui] [verify] [test] [auth] [deploy] [docs] [devx] [util] [cfg] [search] [valid]

---

## Milestone 1 — Cleanup

Tech debt, testing gaps, DX, docs, validation, minor code-quality fixes.

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

---

## Milestone 2 — Restricted Paywall Access

Publisher-specific PDF resolution, proxy improvements, institutional auth.

- [fetch] L - Implement Springer Link PDF resolution via publisher adapter
- [fetch] L - Implement Elsevier ScienceDirect PDF resolution via publisher adapter
- [fetch] L - Implement ACM Digital Library PDF resolution via publisher adapter
- [fetch] L - PubMed/NCBI E-utilities resolver for life-sciences papers
- [fetch] M - Wire publisher adapters into RetrievalOrchestrator fallback chain
- [fetch] M - Exponential backoff retry for failed HTTP download attempts
- [auth] XL - SAML/Shibboleth SSO authentication for institutional access
- [auth] M - API key management for publisher APIs (Elsevier, Springer)
- [auth] M - Proxy rotation across multiple configured institutional proxies — currently only proxies[0] used

---

## Milestone 3 — Data Richness

More import/export formats, additional resolvers, enriched metadata, full-text search.

- [fetch] L - Semantic Scholar API resolver for open-access links and citation graph
- [fetch] M - Metadata enrichment from Crossref: abstract, keywords, licence, ISSN
- [fetch] S - DoiResolver: populate isOpenAccess field — currently always undefined
- [search] L - Full-text search of extracted Markdown content using SQLite FTS5
- [parse] M - RIS reference format import (.ris files)
- [parse] M - Zotero JSON export format import
- [parse] S - CSV metadata import (title + DOI columns)
- [cli] M - `export` CLI command: write BibTeX/RIS/JSON from database
- [cli] M - `search` CLI command: query citations by author/year/journal/title
- [cli] M - `verify` CLI command: re-check all citations and update verification status
- [cli] S - `update` CLI command: re-download or refresh metadata for a single citation
- [cli] XS - `stats` CLI command: citation status summary and database size
- [mcp] M - MCP tool: search-citations (by author/year/journal/title keyword)
- [mcp] S - MCP tool: update-citation metadata
- [mcp] S - MCP tool: delete-citation
- [mcp] S - MCP tool: get-retrieval-log (download attempt history for a DOI)
- [db] M - Citation deduplication via fuzzy title matching before insert
- [db] S - Database backup and restore commands
- [verify] M - Markdown post-processing: remove artefact lines, normalise headings
- [verify] S - Quality metrics for extracted Markdown (word count, section count, table detection)

---

## Milestone 4 — Production Readiness

Concurrency, deployment, OCR, advanced TUI, watch mode, config.

- [flow] L - Concurrent/parallel PDF downloads with configurable concurrency limit
- [flow] L - `watch` mode: monitor a directory for new .bib files and auto-import
- [flow] M - Resume interrupted batch import from last successful entry
- [flow] M - Webhook notification on batch import completion (configurable URL)
- [verify] XL - OCR fallback for scanned PDFs (tesseract.js or external API)
- [verify] L - Reference list extraction from extracted Markdown
- [deploy] L - Docker container image and Compose file for server mode
- [deploy] M - npm publish pipeline and versioned GitHub Releases
- [deploy] S - Systemd service unit file for persistent MCP server daemon
- [tui] L - Interactive TUI: multi-select bulk operations (delete, re-download)
- [tui] M - Interactive TUI: paginated, sortable, filterable citations table
- [tui] M - Interactive TUI: live per-citation download progress bars
- [cfg] M - Persistent config file (~/.citation-needed/config.json) for default flags

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
