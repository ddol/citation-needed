# System Architecture

## Overview

`citation-needed` is a citation retrieval and Markdown extraction sidecar for AI agents. Its main workflow ingests a BibTeX file, downloads PDFs into a local folder, and writes Markdown output for each resolved paper.

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
    │         ├──► resolvers/ (arXiv, Unpaywall, DOI)
    │         └──► downloaders/ (OpenAccess, Auth)
    │
    └──► verification/markdown.ts
              │
              ▼
        markdown/*.md output
```

## Database Schema

Two tables in SQLite (`~/.citation-needed/citations.db`):

- **citations** – core citation data (doi, title, authors, pdf_path, verification_status, …)
- **retrieval_log** – log of every PDF retrieval attempt (source, success, duration)

## CLI Output Defaults

When `citation-needed import-bibtex path/to/references.bib` runs:

- PDFs are written to `path/to/papers/`
- Markdown files are written to `path/to/markdown/`

You can override the PDF directory with `--paper-path`.

## MCP Server

The MCP server (`src/mcp/server.ts`) exposes two groups of tools:

| Module | Tools |
|--------|-------|
| `tools/citations.ts` | get-citation, list-citations, import-bibtex, search-arxiv |
| `tools/retrieval.ts` | download-pdf |
