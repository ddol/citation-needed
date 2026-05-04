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
List all stored citations.

**Input:** `{}`

**Output:** JSON array of citation objects.

---

### `import-bibtex`
Import citations from a BibTeX string.

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
Download a PDF for a citation (tries open-access sources first).

**Input:**
```json
{
  "doi": "10.1234/example",
  "pdfUrl": "https://example.com/paper.pdf",
  "useUnpaywall": true,
  "email": "you@university.edu"
}
```
**Output:** Path to downloaded PDF or error message.

---

## Verification Tools

### `verify-citation`
Verify a claim against locally stored PDF Markdown.

**Input:**
```json
{
  "doi": "10.1234/example",
  "claim": "This paper proposes a transformer architecture",
  "pdfMarkdown": "optional pre-extracted markdown..."
}
```
**Output:**
```json
{
  "verified": true,
  "matchedKeywords": ["paper", "proposes", "transformer"],
  "totalKeywords": 4,
  "notes": "75% keyword match (3/4)",
  "pdfAvailable": true
}
```
