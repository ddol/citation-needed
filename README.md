# citation-needed

![citation needed](https://imgs.xkcd.com/comics/wikipedian_protester.png)

> Citation retrieval and verification sidecar for AI agents — backs academic citations with locally stored PDFs.

AI agents hallucinate citations. **citation-needed** helps by storing citation metadata in SQLite, downloading open-access PDFs (arXiv, Unpaywall), converting PDFs to Markdown, and exposing retrieval and verification workflows through a CLI and MCP server.

---

## Features

- 📚 **BibTeX import** — parse and ingest `.bib` files
- 🗄️ **SQLite database** — track citations, PDF paths, and verification status
- 🔓 **Open-access retrieval** — arXiv API and Unpaywall API
- 🔒 **Authenticated PDF download** — via Playwright for proxy-gated content (optional)
- 📝 **PDF to Markdown extraction** — convert downloaded PDFs into Markdown in JavaScript
- ✅ **Claim verification** — compare claims against extracted PDF Markdown
- 🖥️ **Ink CLI** — interactive terminal UI for managing citations
- 🤖 **MCP server** — Model Context Protocol tools for AI agent integration

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
# Import citations from a BibTeX file
citation-needed import-bibtex references.bib

# List all citations
citation-needed list

# Download a PDF for a citation
citation-needed download 10.1234/example.doi --url https://arxiv.org/pdf/2301.12345
# or use Unpaywall for open-access lookup:
citation-needed download 10.1234/example.doi --email you@example.com

# Verify a claim against a citation
citation-needed verify 10.1234/example.doi "neural networks outperform SVMs on CIFAR-10"

# Start the MCP server (stdio transport)
citation-needed server
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CITATION_NEEDED_DB` | `~/.citation-needed/citations.db` | Path to SQLite database |
| `CITATION_NEEDED_PDF_DIR` | `~/.citation-needed/pdfs` | Directory for downloaded PDFs |

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

| Tool | Description | Required params |
|---|---|---|
| `get-citation` | Get citation details | `doi` |
| `import-bibtex` | Import citations from BibTeX string | `bibtex` |
| `verify-citation` | Verify a claim against stored PDF Markdown | `doi`, `claim` |
| `download-pdf` | Download PDF for a citation | `doi` |
| `list-citations` | List all citations | — |
| `search-arxiv` | Search arXiv by paper title | `title` |

#### Example agent usage

```
User: "Is the claim that 'transformers outperform RNNs on long sequences' supported?"

Agent calls:
  search-arxiv(title: "transformers long sequences")
  → [{arxivId: "1706.03762", title: "Attention Is All You Need", ...}]

  download-pdf(doi: "10.48550/arxiv.1706.03762", pdfUrl: "https://arxiv.org/pdf/1706.03762")

  verify-citation(doi: "10.48550/arxiv.1706.03762", claim: "transformers outperform RNNs on long sequences")
  → {verified: true, matchedKeywords: ["transformers", "sequences"], totalKeywords: 3, notes: "67% keyword match (2/3)"}
```

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
├── auth/                 # Auth config (Unpaywall email, proxies)
├── verification/         # PDF Markdown extraction + claim verification
├── mcp/                  # MCP server with per-tool modules
├── tui/                  # Ink React components
└── cli/                  # Commander CLI with per-command files
```

---

## License

MIT

anti-hallucination academic citation assistant
