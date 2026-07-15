# citation-needed

![citation needed](https://imgs.xkcd.com/comics/wikipedian_protester.png)

> Citation retrieval, indexing, and Markdown extraction sidecar for AI agents — turns BibTeX references into a local, searchable PDF/Markdown corpus.

`citation-needed` ingests a BibTeX file, stores citation metadata, downloads PDFs when they can be resolved, converts those PDFs into Markdown using JavaScript, and indexes extracted Markdown for grounded MCP search, reading, and quote checking.

It exists to answer one question about a citation: **is this a real quote, and is it a fair interpretation of the work?** [TENETS.md](TENETS.md) states the commitments that follow from that; [DESIGN.md](DESIGN.md) turns them into rules for the code.

---

## Features

- 📚 **BibTeX-first workflow** — process a `.bib` file in one run
- 🗄️ **SQLite database** — track citation metadata, PDF paths, and processing status
- 🔓 **Open-access retrieval** — arXiv API and Unpaywall API
- 🔒 **Authenticated PDF download** — via Playwright for proxy-gated content (optional)
- 📝 **PDF to Markdown extraction** — convert downloaded PDFs into Markdown in JavaScript
- 📁 **Automatic output folders** — write PDFs to `papers/pdf/` and Markdown to `papers/markdown/` by default
- 🔎 **Local full-text index** — chunk extracted Markdown into SQLite FTS5 tables with section provenance
- 🤖 **MCP server** — Model Context Protocol tools for citation metadata, retrieval, search, content reading, and quote verification

---

## Installation

```bash
npm install -g citation-needed
# or run locally:
git clone https://github.com/your-org/citation-needed
cd citation-needed
npm install
npm run build
```

For authenticated PDF downloads via Playwright (optional):

```bash
npm install playwright
npx playwright install chromium
```

---

## CLI Usage

```bash
# Import a BibTeX file, download PDFs into ./papers/pdf, and write Markdown into ./papers/markdown
citation-needed import-bibtex references.bib

# Override the PDF output directory for the run
citation-needed import-bibtex references.bib --paper-path ./downloaded-papers

# List stored citations
citation-needed list

# Index extracted Markdown into the full-text search tables
citation-needed index

# Download a single PDF manually if needed
citation-needed download 10.1234/example.doi --url https://arxiv.org/pdf/2301.12345

# Configure auth data used by import/retrieval flows
citation-needed auth set-email you@university.edu
citation-needed auth add-proxy campus https://proxy.university.edu \
  --login-url https://proxy.university.edu/login \
  --username jdoe \
  --password-env PROXY_PASSWORD

# Start the MCP server (stdio transport)
citation-needed server
```

By default, `import-bibtex` writes PDFs to a `papers/pdf/` folder next to the BibTeX file and Markdown files to `papers/markdown/`. File naming prefers the BibTeX key, then DOI. Use `--paper-path` and `--markdown-path` to change output directories for that run.

The standalone `download` command only downloads a PDF and updates an existing citation when that DOI is already in the database. It requires either `--url` or `--email` for an Unpaywall lookup; the fuller retrieval cascade, Markdown extraction, and proxy-authenticated fallback live in `import-bibtex`.

---

## Environment Variables

| Variable                  | Default                           | Description                                                      |
| ------------------------- | --------------------------------- | ---------------------------------------------------------------- |
| `CITATION_NEEDED_DIR`     | `~/.citation-needed`              | Base data directory (auth config, db, pdf defaults)              |
| `CITATION_NEEDED_DB`      | `~/.citation-needed/citations.db` | Path to SQLite database                                          |
| `CITATION_NEEDED_PDF_DIR` | `~/.citation-needed/pdfs`         | Fallback directory for standalone PDF downloads                  |
| `CITATION_NEEDED_EMAIL`   | _(unset)_                         | Contact email sent to Unpaywall and the Crossref User-Agent      |
| `LOG_LEVEL`               | `info`                            | Logger verbosity: `debug` / `info` / `warn` / `error` / `silent` |

See `.env.example` for a copy-paste starter.

---

## MCP Server Setup

Add to your MCP client configuration (e.g., Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "citation-needed": {
      "command": "citation-needed",
      "args": ["server"]
    }
  }
}
```

### MCP Tools

| Tool               | Description                                         | Required params |
| ------------------ | --------------------------------------------------- | --------------- |
| `get-citation`     | Get citation details                                | `doi`           |
| `list-citations`   | List citations, optionally cursor-paginated         | —               |
| `import-bibtex`    | Import citation metadata from a BibTeX string       | `bibtex`        |
| `search-arxiv`     | Search arXiv by paper title                         | `title`         |
| `download-pdf`     | Download PDF from `pdfUrl` or Unpaywall             | `doi`           |
| `search-citations` | Search metadata and indexed Markdown                | `query`         |
| `read-content`     | Read extracted Markdown by DOI                      | `doi`           |
| `verify-quote`     | Check a quote against one paper or the whole corpus | `quote`         |

`import-bibtex` over MCP currently imports metadata only. Use the CLI `import-bibtex` command for the full download and Markdown extraction pipeline, then run `citation-needed index` before relying on body-text search and section-provenance quote checks.

---

## Development

```bash
npm run build      # Compile TypeScript
npm test           # Run Jest tests
npm run dev        # Run with ts-node (no build required)
```

### Project Structure

```
src/
├── index.ts              # Entry point
├── models/               # Shared TypeScript interfaces
├── utils/                # Logger, RateLimiter, file helpers
├── parsers/              # BibTeX, DOI, URL parsers
├── db/                   # SQLite database (schema + Database class)
├── retrieval/
│   ├── resolvers/        # arXiv, Unpaywall, and Crossref/DOI helper resolvers
│   ├── downloaders/      # Open-access + authenticated PDF downloaders
│   ├── publishers/       # Publisher URL adapters (Springer, Elsevier, ACM)
│   └── index.ts          # RetrievalOrchestrator
├── verification/         # PDF Markdown extraction helpers
├── workflows/            # BibTeX batch processing workflow
├── mcp/                  # MCP server with per-tool modules
├── tui/                  # Ink React components
└── cli/                  # Commander CLI with per-command files
```

---

## License

MIT
