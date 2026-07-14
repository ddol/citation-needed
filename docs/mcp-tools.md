# MCP Tools Reference

All tools are available via the MCP server started with `citation-needed server`.

## Citation Tools

### `get-citation`

Get citation details by DOI.

**Input:**

```json
{ "doi": "10.1234/example.001" }
```

**Output:** JSON object with citation fields.

---

### `list-citations`

List stored citations. With no arguments, this preserves the legacy behavior and
returns a JSON array of all citations. With `cursor` or `limit`, it returns a
paginated object.

**Input:**

```json
{ "limit": 50, "cursor": "…" }
```

**Output:** JSON array of citation objects, or `{ "citations": [...], "nextCursor": "…" }` when pagination arguments are supplied.

---

### `import-bibtex`

Import citation metadata from a BibTeX string into the database. This MCP tool
does not download PDFs or extract Markdown; use the CLI `import-bibtex` command
for the full pipeline.

**Input:**

```json
{ "bibtex": "@article{...}" }
```

**Output:** Confirmation message with import count.

---

### `search-arxiv`

Search arXiv for a paper by title.

**Input:**

```json
{ "title": "Attention is All You Need" }
```

**Output:** JSON array of `{ arxivId, pdfUrl, title }` objects.

---

## Retrieval Tools

### `download-pdf`

Download a PDF for a citation from a direct `pdfUrl`, or from Unpaywall when
`useUnpaywall` is true and an email is available. This tool does not use the
institutional-proxy authenticated downloader.

**Input:**

```json
{
  "doi": "10.1234/example",
  "pdfUrl": "https://example.com/paper.pdf",
  "useUnpaywall": true,
  "email": "you@university.edu"
}
```

**Output:** Path to downloaded PDF or error message. If the DOI is already in
the database, the citation's PDF path and verification status are updated.

---

## Grounding Tools

### `search-citations`

Search the local corpus by title, author, journal, BibTeX key, or DOI. Returns
trimmed summaries; use `get-citation` for full details.

**Input:**

```json
{ "query": "trajectory anomaly", "limit": 20, "cursor": "…" }
```

**Output:**

```json
{
  "results": [
    {
      "citation": {
        "doi": "10.1234/example",
        "title": "Trajectory Anomaly Detection",
        "year": 2024,
        "journal": "J Traffic",
        "verificationStatus": "downloaded"
      },
      "matchedFields": ["title"],
      "matches": [
        {
          "chunkOrdinal": 1,
          "sectionPath": ["Methods", "Classification"],
          "snippet": "…uses <b>lidar</b> point clouds…"
        }
      ]
    }
  ],
  "nextCursor": "…"
}
```

Search runs on the FTS5 index (bm25 ranking, stemming, phrase support via a
fully quoted query) once `citation-needed index` has run; `matches` carries
body-text hits with section provenance. Substring queries fall back to LIKE.

---

### `read-content`

Read a paper's extracted Markdown by DOI, paginated by character offset.

**Input:**

```json
{ "doi": "10.1234/example", "maxChars": 20000, "cursor": "…" }
```

**Output:**

```json
{ "doi": "10.1234/example", "title": "…", "text": "…", "nextCursor": "…" }
```

`nextCursor` is present while more text remains. Requires the citation's
Markdown to have been extracted by the import pipeline.

---

### `verify-quote`

Check whether a quoted passage appears in the corpus (or one paper, when `doi`
is given). Matching is exact after normalization: whitespace, line-break
hyphenation, unicode quotes/ligatures, and case are folded.

**Input:**

```json
{ "quote": "classification of \"trajectory anomalies\" uses lidar", "doi": "10.1234/example" }
```

**Output:**

```json
{
  "verdict": "exact",
  "matches": [
    {
      "doi": "10.1234/example",
      "similarity": 1,
      "snippet": "…",
      "sectionPath": ["Methods", "Classification"],
      "chunkOrdinal": 1
    }
  ]
}
```

`verdict` is `exact`, `close-match`, or `not-found` (omit `doi` to search the
whole corpus). `close-match` is the FTS-backed fuzzy fallback for minor
misquotes: similarity is the fraction of quote tokens found in the best
candidate chunk (threshold 0.8). Section provenance appears once the corpus is
indexed via `citation-needed index`.
