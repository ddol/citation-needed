# citation-needed

![citation needed](https://imgs.xkcd.com/comics/wikipedian_protester.png)

> Citation retrieval and Markdown extraction sidecar for AI agents — turns BibTeX references into local PDF and Markdown folders.

`citation-needed` ingests a BibTeX file, stores citation metadata, downloads PDFs when they can be resolved, and converts those PDFs into Markdown using JavaScript.

---

## Features

- 📚 **BibTeX-first workflow** — process a `.bib` file in one run
- 🗄️ **SQLite database** — track citation metadata, PDF paths, and processing status
- 🔓 **Open-access retrieval** — arXiv API and Unpaywall API
- 🔒 **Authenticated PDF download** — via Playwright for proxy-gated content (optional)
- 📝 **PDF to Markdown extraction** — convert downloaded PDFs into Markdown in JavaScript
- 📁 **Automatic output folders** — write PDFs to `papers/` and Markdown to `markdown/` by default
- 🤖 **MCP server** — Model Context Protocol tools for citation metadata and retrieval

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

# Download a single PDF manually if needed
citation-needed download 10.1234/example.doi --url https://arxiv.org/pdf/2301.12345

# Start the MCP server (stdio transport)
citation-needed server
```

By default, `import-bibtex` writes PDFs to a `papers/pdf/` folder next to the BibTeX file and Markdown files to `papers/markdown/`. File naming is determined by the current retrieval and conversion pipeline. Use `--paper-path` to change the PDF output directory for that run.

---

## Environment Variables

| Variable                  | Default                           | Description                                     |
| ------------------------- | --------------------------------- | ----------------------------------------------- |
| `CITATION_NEEDED_DB`      | `~/.citation-needed/citations.db` | Path to SQLite database                         |
| `CITATION_NEEDED_PDF_DIR` | `~/.citation-needed/pdfs`         | Fallback directory for standalone PDF downloads |

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

| Tool             | Description                                           | Required params |
| ---------------- | ----------------------------------------------------- | --------------- |
| `get-citation`   | Get citation details                                  | `doi`           |
| `import-bibtex`  | Import citations from BibTeX string into the database | `bibtex`        |
| `download-pdf`   | Download PDF for a citation                           | `doi`           |
| `list-citations` | List all citations                                    | —               |
| `search-arxiv`   | Search arXiv by paper title                           | `title`         |

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
│   ├── resolvers/        # arXiv, Unpaywall, DOI/Crossref resolvers
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
