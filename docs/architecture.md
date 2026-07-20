# System architecture

## Overview

`citation-needed` is a citation retrieval and Markdown extraction sidecar for AI agents. Its main workflow ingests a BibTeX file, downloads PDFs into a local folder, and writes Markdown output for each resolved paper.
Extracted Markdown can then be chunked into SQLite FTS5 tables so MCP clients can search the corpus, read extracted content, and verify quoted passages.

## Module structure

```
src/
  models/       – Shared TypeScript interfaces (Citation, AuthConfig, …)
  utils/        – Logger, RateLimiter, file helpers
  parsers/      – BibTeX parser, DOI normalizer, URL classifier
  db/           – SQLite database layer (better-sqlite3) + versioned migrations
  retrieval/    – PDF retrieval: cascade, resolvers, downloaders, publisher adapters,
                  shared title matching and throttle-aware HTTP
  services/     – SearchService, ContentService, indexer, zod contracts
  auth/         – Authentication config (contact email, institutional proxies)
  verification/ – PDF-to-Markdown extraction helpers
  workflows/    – BibTeX batch processing orchestration
  mcp/          – MCP server with tool modules
  tui/          – Ink (React), output that redraws while work runs (ImportProgress)
  cli/          – Commander CLI; static output via cli/output.ts
```

## Data flow

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
    ├──► retrieval/index.ts (RetrievalOrchestrator)
    │         │
    │         ├──► the cascade (below)
    │         └──► downloaders/ (OpenAccess, Auth)
    │
    └──► verification/markdown.ts
              │
              ▼
papers/markdown/*.md output
```

### Retrieval cascade

`RetrievalOrchestrator.retrievePdf` tries each stage in order and stops at the
first PDF:

| Stage            | Keyed by | Notes                                                         |
| ---------------- | -------- | ------------------------------------------------------------- |
| cache            | DOI      | Existing `pdf_path` on disk, or a matching file stem          |
| Unpaywall        | DOI      | Needs a contact email; skipped (and said so) without one      |
| Semantic Scholar | DOI      | Aggregates arXiv, publisher OA, and repositories              |
| arXiv            | title    | Quoted phrase search; strictest identity check                |
| publisher        | DOI      | Wired but resolves no URLs; removal tracked in the plan below |
| authenticated    | DOI      | Institutional proxy; only when one is configured              |

DOI-keyed sources run before the title search because a DOI names exactly one
paper while a search is a guess. Every candidate's title is checked before
download (`retrieval/title-match.ts`), strictly for title search and loosely for
DOI lookups, where the DOI already proves identity. Each stage appends a line to
`attempts`, which becomes the failure message, and every attempt is written to
`retrieval_log`.

`citation-needed index` is the follow-on indexing step. It walks stored citations,
locates extracted Markdown, records/refreshes manifestations, chunks Markdown by
heading, and populates the FTS5 index used by `search-citations` and
`verify-quote`.

The Crossref/DOI resolver still exists as a metadata helper, but it is not part
of the active PDF download cascade today.

## Database schema

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

## CLI commands

| Command                  | Purpose                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `import-bibtex`          | Full pipeline: parse → retrieve → extract Markdown         |
| `check-local-papers`     | Offline audit of a PDF folder against a `.bib`, no network |
| `extract-markdown`       | Re-run local PDF-to-Markdown extraction without downloads  |
| `score-markdown-quality` | Local Markdown/PDF quality scoring for extraction loops    |
| `index`                  | Chunk extracted Markdown into the FTS5 tables              |
| `list`                   | List stored citations                                      |
| `download`               | Fetch one PDF for a DOI already in the database            |
| `reset`                  | Maintenance: wipe the database (dry run unless `--yes`)    |
| `auth`                   | Configure contact email and institutional proxies          |
| `server`                 | Start the MCP server (stdio)                               |

When `citation-needed import-bibtex path/to/references.bib` runs:

- PDFs are written to `path/to/papers/pdf/`
- Markdown files are written to `path/to/papers/markdown/`

You can override the PDF directory with `--paper-path` and the Markdown
directory with `--markdown-path`.

## MCP server

The MCP server (`src/mcp/server.ts`) exposes these tool groups:

| Module               | Tools                                                     |
| -------------------- | --------------------------------------------------------- |
| `tools/citations.ts` | get-citation, list-citations, import-bibtex, search-arxiv |
| `tools/retrieval.ts` | download-pdf                                              |
| `tools/grounding.ts` | search-citations, read-content, verify-quote              |

`import-bibtex` over MCP is metadata-only today. The full download, extraction,
manifestation recording, and Markdown-output pipeline is the CLI
`import-bibtex` workflow.

## Planned evolution

Forward-looking plans (import-service consolidation, indexing jobs, HTTP API,
citation graph, storage adapters, vector search, and Zotero work) live in
[docs/plans/](plans/README.md). Scheduled work is the Core section of
[BACKLOG.md](../BACKLOG.md); everything else there is Exploratory.
