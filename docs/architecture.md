# System Architecture

## Overview

`citation-needed` is a citation retrieval and Markdown extraction sidecar for AI agents. Its main workflow ingests a BibTeX file, downloads PDFs into a local folder, and writes Markdown output for each resolved paper.
Extracted Markdown can then be chunked into SQLite FTS5 tables so MCP clients can search the corpus, read extracted content, and verify quoted passages.

## Module Structure

```
src/
  models/       – Shared TypeScript interfaces (Citation, AuthConfig, …)
  utils/        – Logger, RateLimiter, file helpers
  parsers/      – BibTeX parser, DOI normalizer, URL classifier
  db/           – SQLite database layer (better-sqlite3)
  retrieval/    – PDF retrieval: resolvers, downloaders, publisher adapters
  auth/         – Authentication config (Unpaywall email, institutional proxies)
  verification/ – PDF-to-Markdown extraction helpers
  workflows/    – BibTeX batch processing orchestration
  mcp/          – MCP server with tool modules
  tui/          – Ink (React) terminal UI components
  cli/          – Commander-based CLI commands
```

## Data Flow

```
BibTeX file
    │
    ▼
workflows/process-bibtex.ts
    │
    ├──► parsers/bibtex.ts
    │         │
    │         ▼
    │     db/index.ts (store Citation)
    │
    ├──► retrieval/index.ts
    │         │
    │         ├──► PDF download cascade (Unpaywall, then arXiv by stored title)
    │         └──► downloaders/ (OpenAccess, Auth)
    │
    └──► verification/markdown.ts
              │
              ▼
papers/markdown/*.md output
```

`citation-needed index` is the follow-on indexing step. It walks stored citations,
locates extracted Markdown, records/refreshes manifestations, chunks Markdown by
heading, and populates the FTS5 index used by `search-citations` and
`verify-quote`.

The Crossref/DOI resolver still exists as a metadata helper, but it is not part
of the active PDF download cascade today.

## Database Schema

SQLite (`~/.citation-needed/citations.db`), evolved through versioned
migrations (`PRAGMA user_version`, `src/db/migrations.ts`):

- **citations** – core citation data (doi, title, authors, verification_status, …)
- **retrieval_log** – log of every PDF retrieval attempt (source, success, duration)
- **manifestations** – files representing a citation (PDF, extracted Markdown) with
  content hashes; the source of truth for file locations (`pdf_path` is a
  transition fallback)
- **chunks** – heading-based sections of extracted Markdown with `sectionPath`
  provenance
- **chunks_fts / citations_fts** – external-content FTS5 indexes (porter
  unicode61), kept in sync by triggers; populated by `citation-needed index`

## CLI Output Defaults

When `citation-needed import-bibtex path/to/references.bib` runs:

- PDFs are written to `path/to/papers/pdf/`
- Markdown files are written to `path/to/papers/markdown/`

You can override the PDF directory with `--paper-path` and the Markdown
directory with `--markdown-path`.

## MCP Server

The MCP server (`src/mcp/server.ts`) exposes these tool groups:

| Module               | Tools                                                     |
| -------------------- | --------------------------------------------------------- |
| `tools/citations.ts` | get-citation, list-citations, import-bibtex, search-arxiv |
| `tools/retrieval.ts` | download-pdf                                              |
| `tools/grounding.ts` | search-citations, read-content, verify-quote              |

`import-bibtex` over MCP is metadata-only today. The full download, extraction,
manifestation recording, and Markdown-output pipeline is the CLI
`import-bibtex` workflow.

## Planned Evolution

Forward-looking plans — import-service consolidation, indexing jobs, HTTP API,
citation graph, storage adapters, vector search, and Zotero work — live in
[docs/plans/](plans/README.md). Scheduled work is the Core section of
[BACKLOG.md](../BACKLOG.md); everything else there is Exploratory.
