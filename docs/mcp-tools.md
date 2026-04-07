# MCP Tools Reference

All tools are available via the MCP server started with `sober-sources server`.

## Citation Tools

### `get-citation`
Get citation details and trust score by DOI.

**Input:**
```json
{ "doi": "10.1234/example.001" }
```
**Output:** JSON object with citation fields plus `trustLevel` (`high`/`medium`/`low`/`unverified`).

---

### `list-citations`
List all stored citations with trust scores.

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
  "pdfUrl": "https://example.com/paper.pdf",   // optional
  "useUnpaywall": true,                          // optional
  "email": "you@university.edu"                  // required if useUnpaywall
}
```
**Output:** Path to downloaded PDF or error message.

---

## Verification Tools

### `verify-citation`
Verify a claim against locally stored PDF content.

**Input:**
```json
{
  "doi": "10.1234/example",
  "claim": "This paper proposes a transformer architecture",
  "pdfContent": "optional pre-extracted text..."
}
```
**Output:** `{ score, verified, notes }`

---

### `update-trust-score`
Update the trust score for a citation with an absolute value.

**Input:**
```json
{
  "doi": "10.1234/example",
  "score": 0.85,
  "notes": "Manually verified against source",
  "agentId": "gpt-4"
}
```
**Output:** Confirmation message.
