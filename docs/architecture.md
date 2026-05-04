# System Architecture

## Overview

`citation-needed` is a citation retrieval and verification sidecar for AI agents that grounds academic citations in locally stored PDFs. It exposes both a CLI and an MCP (Model Context Protocol) server interface.

## Module Structure

```
src/
  models/       – Shared TypeScript interfaces (Citation, AuthConfig, …)
  utils/        – Logger, RateLimiter, file helpers
  parsers/      – BibTeX parser, DOI normalizer, URL classifier
  db/           – SQLite database layer (better-sqlite3)
  retrieval/    – PDF retrieval: resolvers, downloaders, publisher adapters
  auth/         – Authentication config (Unpaywall email, institutional proxies)
  verification/ – PDF-to-Markdown extraction and claim verification
  mcp/          – MCP server with tool modules
  tui/          – Ink (React) terminal UI components
  cli/          – Commander-based CLI commands
```

## Data Flow

```
BibTeX / DOI input
      │
      ▼
  parsers/bibtex.ts ──► db/index.ts (store Citation)
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
         retrieval/index.ts     verification/verifier.ts
         (RetrievalOrchestrator)   (ClaimVerifier)
                    │                     │
          ┌─────────┴────────┐            │
          ▼                  ▼            │
    resolvers/         downloaders/       │
    (arXiv, Unpaywall, DOI)  (OpenAccess, Auth)
                    │                     │
                    ▼                     │
              local PDF file              │
                    │                     │
                    ▼                     ▼
         verification/markdown.ts   VerificationResult
```

## Database Schema

Two tables in SQLite (`~/.citation-needed/citations.db`):

- **citations** – core citation data (doi, title, authors, pdf_path, verification_status, …)
- **retrieval_log** – log of every PDF retrieval attempt (source, success, duration)

## MCP Server

The MCP server (`src/mcp/server.ts`) exposes three groups of tools:

| Module | Tools |
|--------|-------|
| `tools/citations.ts` | get-citation, list-citations, import-bibtex, search-arxiv |
| `tools/retrieval.ts` | download-pdf |
| `tools/verification.ts` | verify-citation |

## Verification Workflow

`ClaimVerifier` converts a local PDF to Markdown, extracts keywords from the incoming claim, and reports whether the claim is supported by the extracted content. Verification results include matched keywords, total keywords considered, explanatory notes, and whether a PDF was available during verification.
