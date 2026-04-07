# sober-sources

> Trust and verification sidecar for AI agents — backs academic citations with locally verified PDFs.

AI agents hallucinate citations. **sober-sources** fixes that by storing a local SQLite database of DOIs with trust scores, downloading open-access PDFs (arXiv, Unpaywall), and exposing everything via an MCP server that any agent can query.

---

## Features

- 📚 **BibTeX import** — parse and ingest `.bib` files
- 🗄️ **SQLite database** — track citations, PDF paths, and trust scores
- 🔓 **Open-access retrieval** — arXiv API and Unpaywall API
- 🔒 **Authenticated PDF download** — via Playwright for proxy-gated content (optional)
- 🖥️ **Ink CLI** — interactive terminal UI for managing citations
- 🤖 **MCP server** — Model Context Protocol tools for AI agent integration
- 📊 **Trust scoring** — feedback loop to raise/lower confidence per citation

---

## Installation

```bash
npm install -g sober-sources
# or run locally:
git clone https://github.com/your-org/sober-sources
cd sober-sources
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
sober-sources import-bibtex references.bib

# List all citations with trust scores
sober-sources list

# Download a PDF for a citation
sober-sources download 10.1234/example.doi --url https://arxiv.org/pdf/2301.12345
# or use Unpaywall for open-access lookup:
sober-sources download 10.1234/example.doi --email you@example.com

# Verify a claim against a citation
sober-sources verify 10.1234/example.doi "neural networks outperform SVMs on CIFAR-10"

# Show trust score details and history
sober-sources score 10.1234/example.doi

# Start the MCP server (stdio transport)
sober-sources server
```

Trust scores are color-coded in the list view:
- 🟢 **Green** (≥ 0.7) — high confidence
- 🟡 **Yellow** (0.4–0.7) — medium confidence
- 🔴 **Red** (< 0.4) — low confidence

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SOBER_SOURCES_DB` | `~/.sober-sources/citations.db` | Path to SQLite database |
| `SOBER_SOURCES_PDF_DIR` | `~/.sober-sources/pdfs` | Directory for downloaded PDFs |

---

## MCP Server Setup

Add to your MCP client configuration (e.g., Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "sober-sources": {
      "command": "sober-sources",
      "args": ["server"]
    }
  }
}
```

### MCP Tools

| Tool | Description | Required params |
|---|---|---|
| `get-citation` | Get citation details and trust score | `doi` |
| `import-bibtex` | Import citations from BibTeX string | `bibtex` |
| `verify-citation` | Verify a claim against stored PDF | `doi`, `claim` |
| `update-trust-score` | Update trust score with feedback | `doi`, `score` |
| `download-pdf` | Download PDF for a citation | `doi` |
| `list-citations` | List all citations with trust scores | — |
| `search-arxiv` | Search arXiv by paper title | `title` |

#### Example agent usage

```
User: "Is the claim that 'transformers outperform RNNs on long sequences' supported?"

Agent calls:
  search-arxiv(title: "transformers long sequences") 
  → [{arxivId: "1706.03762", title: "Attention Is All You Need", ...}]
  
  download-pdf(doi: "10.48550/arxiv.1706.03762", pdfUrl: "https://arxiv.org/pdf/1706.03762")
  
  verify-citation(doi: "10.48550/arxiv.1706.03762", claim: "transformers outperform RNNs on long sequences")
  → {score: 0.75, verified: true, notes: "85% keyword match in PDF"}
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
├── db/index.ts           # SQLite database
├── bibtex/parser.ts      # BibTeX parser
├── retrieval/
│   ├── arxiv.ts          # arXiv API
│   ├── unpaywall.ts      # Unpaywall API
│   └── downloader.ts     # PDF downloader
├── cli/app.tsx           # Ink CLI
├── server/mcp.ts         # MCP server
└── trust/scorer.ts       # Trust scoring
```

---

## License

MIT

anti-hallucinations academic citation assistant 
