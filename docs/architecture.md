# System Architecture

## Overview

`citation-needed` is a trust-and-verification sidecar for AI agents that grounds academic citations in locally verified PDFs. It exposes both a CLI and an MCP (Model Context Protocol) server interface.

## Module Structure

```
src/
  models/       – Shared TypeScript interfaces (Citation, TrustEvent, AuthConfig, …)
  utils/        – Logger, RateLimiter, file helpers
  parsers/      – BibTeX parser, DOI normalizer, URL classifier
  db/           – SQLite database layer (better-sqlite3)
  retrieval/    – PDF retrieval: resolvers, downloaders, publisher adapters
  auth/         – Authentication config (Unpaywall email, institutional proxies)
  scoring/      – TrustScorer: computes and updates citation trust scores
  verification/ – PDF text extraction and claim verification
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
         retrieval/index.ts        scoring/scorer.ts
         (RetrievalOrchestrator)   (TrustScorer)
                    │                     │
          ┌─────────┴────────┐    ┌───────┴────────┐
          ▼                  ▼    ▼                 ▼
    resolvers/         downloaders/  verifyAndScore  getTrustLevel
    (arXiv, Unpaywall, DOI)  (OpenAccess, Auth)
                    │
                    ▼
              local PDF file
                    │
                    ▼
         verification/extractor.ts
         verification/verifier.ts
                    │
                    ▼
            VerificationResult
            → TrustScorer.updateScore()
```

## Database Schema

Three tables in SQLite (`~/.citation-needed/citations.db`):

- **citations** – core citation data (doi, title, authors, trust_score, verification_status, …)
- **trust_events** – immutable log of every trust score change
- **retrieval_log** – log of every PDF retrieval attempt (source, success, duration)

## MCP Server

The MCP server (`src/mcp/server.ts`) exposes three groups of tools:

| Module | Tools |
|--------|-------|
| `tools/citations.ts` | get-citation, list-citations, import-bibtex, search-arxiv |
| `tools/retrieval.ts` | download-pdf |
| `tools/verification.ts` | verify-citation, update-trust-score |

## Trust Score Model

Scores are floats in [0, 1]:
- **≥ 0.7** → `high`
- **0.4–0.7** → `medium`
- **> 0** → `low`
- **0** → `unverified`

Scores change via `TrustScorer.updateScore(doi, delta, notes)` which clamps to [0,1] and writes an immutable `trust_events` record.
