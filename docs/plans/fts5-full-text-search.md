# FTS5 full-text search

| Field      | Value                                                                            |
| ---------- | -------------------------------------------------------------------------------- |
| Status     | **Core: slices 1–2 shipped** (benchmark + extractor-filter items exploratory)    |
| Flow       | A (verify-quote: B)                                                              |
| Depends on | [service-layer.md](service-layer.md), [domain-model.md](domain-model.md) phase A |

## Intent

Real full-text search over citation metadata **and** extracted Markdown bodies,
with ranking, highlighted snippets, and section provenance, replacing the
`LIKE` implementation inside SearchService without changing its public
contract. Also home to **verify-quote**, the namesake anti-hallucination tool.

## Current state

- Live: heading chunker (`src/services/chunker.ts`), `chunks` table,
  external-content FTS5 tables with sync triggers (`src/db/migrations.ts`;
  `citations_fts` covers title/authors/journal/bibtex_key/doi),
  `citation-needed index` (`src/services/indexer.ts`), SearchService lexical
  mode on FTS5 with LIKE rescue for pre-index databases, and verify-quote v2
  (exact → FTS close-match with section provenance).
- **No page boundaries survive extraction.** `@opendocsg/pdf2md` returns one
  flattened Markdown string (`src/verification/markdown.ts:14`), so
  page-level provenance is **impossible with the current extractor**.
  Provenance is section-level (see Design).
- The indexer and verify-quote resolve Markdown through the shared stem-based
  locator; manifestation-first resolution is
  [domain-model.md](domain-model.md) phase A2 (core, slice 3).
- Related exploratory items: markdown post-processing should run **before**
  chunking (artefact lines poison ranking); the quality-metrics item doubles as
  chunker input validation.

## Design

### Chunking: section-level provenance

A heading-based chunker splits extracted Markdown on the heading trail
(`sectionPath: string[]`), with a max-size split (~2,000 chars, a placeholder
to tune against fixture extractions before freezing) inside long sections.
Typed blocks (figure-caption/code/reference) are out of scope until an
extractor can actually detect them.

```sql
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  citation_id INTEGER NOT NULL REFERENCES citations(id) ON DELETE CASCADE,
  manifestation_id INTEGER NOT NULL REFERENCES manifestations(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  section_path TEXT, -- JSON array of headings, e.g. ["Methods","Classification"]
  text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  UNIQUE (manifestation_id, ordinal)
);
```

### FTS5: external-content tables

External-content, not contentless (`snippet()`/`highlight()` need column
access), and no duplicated corpus copy (text is stored once, in `chunks`). Both
tables ship together: metadata search gets stemming + bm25 too, and
SearchService stays one code path.

```sql
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text,
  content='chunks',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE VIRTUAL TABLE citations_fts USING fts5(
  title, authors, journal, bibtex_key, doi,
  content='citations',
  content_rowid='id',
  tokenize='porter unicode61'
);
```

Kept in sync with AFTER INSERT/UPDATE/DELETE triggers on the content tables
(standard external-content pattern; one trigger set per table).

Example queries:

```sql
-- Ranked chunk search with snippet and provenance
SELECT c.citation_id, c.section_path,
       snippet(chunks_fts, 0, '<b>', '</b>', '…', 12) AS snippet,
       bm25(chunks_fts) AS rank
FROM chunks_fts
JOIN chunks c ON c.id = chunks_fts.rowid
WHERE chunks_fts MATCH ?
ORDER BY rank
LIMIT 20;

-- Field-scoped metadata search
SELECT rowid FROM citations_fts WHERE citations_fts MATCH 'authors:knuth';
```

### SearchService integration

Lexical mode uses FTS5 when the virtual tables exist, `LIKE` otherwise
(pre-index databases keep working). Results gain
`matches: [{ chunkOrdinal, sectionPath, snippet }]`, filling the optional
field reserved in [service-layer.md](service-layer.md). Public contract
unchanged.

### verify-quote (Flow B, trust & verification)

Check that a quoted passage actually appears in a source. Normalization:
collapse whitespace runs, undo line-break hyphenation, fold unicode
quotes/ligatures. With `doi` omitted it searches the whole corpus, which also
locates the true source of a misattributed quote.

Two versions:

- **v1 (core slice 1, no chunks needed)**: normalize → exact substring match
  against the extracted Markdown; verdict `exact | not-found`. Ships with the
  service-layer kernel PR.
- **v2 (core slice 2)**: FTS phrase/NEAR fallback for minor extraction/OCR
  drift, section provenance, and closest-miss reporting via chunks.

```ts
interface VerifyQuoteRequest {
  quote: string;
  doi?: string; // omit to search the whole corpus
}

interface VerifyQuoteResponse {
  verdict: 'exact' | 'close-match' | 'not-found';
  matches: Array<{
    doi: string;
    sectionPath?: string[]; // v2
    chunkOrdinal?: number; // v2
    similarity: number; // 1.0 = exact after normalization
    snippet: string;
  }>;
}
```

### Backfill bridge: `index` CLI command

A one-shot command walks citations → resolves extracted Markdown through the
shared locator (manifestation-first from slice 3, stem match for legacy rows)
→ hashes → chunks → populates FTS. Idempotent by
`content_hash`; on a chunker version bump it eagerly re-chunks everything
(simple and correct at this corpus size;
[indexing-jobs.md](indexing-jobs.md) would make it incremental later).

### Rejected / deferred alternatives

- **Contentless FTS5**: loses `snippet()`/`highlight()`.
- **Storing a second full copy of the corpus**: the index references `chunks`.
- **Trigram tokenizer** for identifiers/titles: no demonstrated need yet.
- **Abstract-field search**: no `abstract` column exists, blocked on the
  Crossref-enrichment item (exploratory).
- **Page-marker injection or extractor swap** for page provenance: pairs with
  the exploratory **external extractor filter contract** (configurable stdin
  PDF → stdout Markdown command; user-wired marker/nougat/OCR, pdf2md default):
  the Unix answer to better extraction without adopting heavy dependencies.
- **Lazy per-document re-chunking**: eager full re-chunk on version bump
  instead.

## Phasing

1. **Spike**: `CREATE VIRTUAL TABLE t USING fts5(x)` smoke test in CI on macOS
   ARM64 + Linux; go/no-go recorded here.
2. **Chunker + chunks table** (needs manifestations from domain-model phase A).
3. **FTS tables + triggers + SearchService swap** (LIKE fallback retained).
4. **`index` command + verify-quote v2 + fixture corpus + golden queries.**

(verify-quote **v1** precedes all of this: it ships in core slice 1 with the
service-layer kernel.)

## Backlog items

Core slice 1 (shipped; see BACKLOG.md § Completed):

- [mcp] M - MCP tool verify-quote v1: normalize a quoted passage, exact-match against extracted Markdown; verdict exact|not-found (see docs/plans/fts5-full-text-search.md)

Core slice 2 (shipped; see BACKLOG.md § Completed):

- [db] S - Spike: assert FTS5 available in bundled better-sqlite3 (CREATE VIRTUAL TABLE smoke test in CI, macOS ARM64 + Linux)
- [verify] S - Heading-based Markdown chunker: sectionPath from heading trail, ~2000-char max split (see docs/plans/fts5-full-text-search.md)
- [db] M - chunks table (citation_id, manifestation_id, ordinal, section_path, text, content_hash) via migration runner
- [search] M - External-content FTS5 tables (chunks_fts, citations_fts; porter unicode61) with sync triggers (see docs/plans/fts5-full-text-search.md)
- [search] M - SearchService lexical mode on FTS5: bm25 ranking, snippet() highlights, section provenance; LIKE fallback pre-index
- [cli] S - `index` CLI command: one-shot (re)index into chunks + FTS; idempotent by content_hash; eager re-chunk on chunker version bump
- [mcp] S - verify-quote v2: FTS fuzzy fallback + section provenance + closest-miss via chunks (see docs/plans/fts5-full-text-search.md)
- [test] S - Search fixture corpus + golden-query tests (phrase, stemming, unicode, section scope)

Exploratory:

- [test] S - FTS benchmark script: index size and query latency at 1k/10k docs, with a size-per-document budget
- [verify] M - Evaluate external extractor filter contract: configurable stdin-PDF→stdout-Markdown command (marker/nougat/OCR user-wired; pdf2md default)

## Testing

- Fixture corpus: 3–4 small Markdown files covering unicode text, deep heading
  nesting, table/artefact lines, plus one empty/degenerate extraction.
- Golden queries: exact phrase, porter stemming (`classifier` ↔ `classifiers`),
  unicode terms, section-scoped assertion via `section_path`, LIKE-fallback
  parity smoke test on an unindexed DB.
- Trigger integrity: update/delete a chunk row, assert FTS stays consistent
  (`INSERT INTO chunks_fts(chunks_fts) VALUES('integrity-check')`).
- verify-quote: exact hit; hyphenation/ligature-normalized hit; close-match via
  FTS NEAR (v2); corpus-wide misattribution find; clean not-found.

## Open questions

1. Store char offsets on chunks for future exact-highlight needs, or is
   `snippet()` output sufficient? (Defaulting to `snippet()`-only until a real
   need appears.)

## Relationship to other plans

- [domain-model.md](domain-model.md): hard dependency: manifestations +
  hashes.
- [service-layer.md](service-layer.md): this plan swaps its internals;
  verify-quote v1 ships in its kernel PR.
- [indexing-jobs.md](indexing-jobs.md): would absorb the one-shot `index`
  command into resumable jobs.
- [vector-hybrid-search.md](vector-hybrid-search.md): shares the `chunks`
  table; embeddings key off `content_hash`.
- [http-api.md](http-api.md): exposes snippets/provenance via `POST /search`.
