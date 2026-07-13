# FTS5 Full-Text Search

| Field         | Value                                                                            |
| ------------- | -------------------------------------------------------------------------------- |
| Status        | **Adopted** (2026-07-12 review)                                                  |
| Milestone(s)  | M3 (+ one benchmark item in M4)                                                  |
| Work-stream   | A — Grounded Answers (verify-quote item: B — Trust & Verification)               |
| Depends on    | [service-layer.md](service-layer.md), [domain-model.md](domain-model.md) phase A |
| Absorbs       | Source exploration §4, §7, §20, §21, Phase 2; decision questions 1–3             |
| Last reviewed | 2026-07-12                                                                       |

## Intent

Real full-text search over citation metadata **and** extracted Markdown bodies,
with ranking, highlighted snippets, and section provenance — replacing the `LIKE`
implementation inside SearchService without changing its public contract. This
supersedes the existing Milestone 3 seed item "[search] L - Full-text search of
extracted Markdown content using SQLite FTS5" with a concrete, decomposed design.

## Current state

Two blockers the source doc missed, plus the baseline:

- **Extraction output is untracked.** `processBibtexFile` writes
  `papers/markdown/<stem>.md` to disk (`src/workflows/process-bibtex.ts:186`) and
  records nothing in the DB — no path column, no hash. Indexing therefore depends
  on [domain-model.md](domain-model.md) phase A (manifestations) landing first.
- **No page boundaries survive extraction.** `@opendocsg/pdf2md` returns one
  flattened Markdown string (`src/verification/markdown.ts:12`), so the source
  doc's `pageStart`/`pageEnd` provenance is **impossible with the current
  extractor**. Provenance is section-level initially (see Design).
- No FTS5 virtual tables exist anywhere; search is `LIKE` on title/authors
  (`src/db/index.ts:310`).
- better-sqlite3's bundled SQLite normally compiles FTS5 in, but this must be
  proven by a smoke test, not assumed (phase 1 spike).
- Related existing M3 seeds: "[verify] M - Markdown post-processing" must run
  **before** chunking (artefact lines poison ranking); "[verify] S - Quality
  metrics" doubles as chunker input validation. Both stay, annotated.

## Design

### Chunking: section-level provenance

A heading-based chunker splits extracted Markdown on the heading trail
(`sectionPath: string[]`), with a max-size split (~2,000 chars — affirmed at
review as a placeholder to tune against fixture extractions before freezing)
inside long sections. The source doc's typed `ExtractedBlock`
(figure-caption/code/reference) is dropped until an extractor can actually detect
those types.

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

External-content (not contentless — `snippet()`/`highlight()` need column access;
not duplicated content — the corpus is stored once, in `chunks`). Both tables ship
together (decided at review — metadata search gets stemming + bm25 too, and
SearchService stays one code path):

```sql
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text,
  content='chunks',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE VIRTUAL TABLE citations_fts USING fts5(
  title, authors, journal,
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

Lexical mode uses FTS5 when the virtual tables exist, `LIKE` otherwise (pre-index
databases keep working). Results gain
`matches: [{ chunkOrdinal, sectionPath, snippet }]` — filling the optional field
reserved in [service-layer.md](service-layer.md). Public contract unchanged.

### verify-quote (added 2026-07-12 product review; stream B — Trust & Verification)

The namesake anti-hallucination tool: check that a quoted passage actually
appears in a source. Pipeline: normalize (collapse whitespace runs, undo
line-break hyphenation, fold unicode quotes/ligatures) → exact substring match
over the cited paper's chunks → FTS phrase/NEAR fallback for minor
extraction/OCR drift → scored result. With `doi` omitted it searches the whole
corpus — which also locates the true source of a misattributed quote.

```ts
interface VerifyQuoteRequest {
  quote: string;
  doi?: string; // omit to search the whole corpus
}

interface VerifyQuoteResponse {
  verdict: 'exact' | 'close-match' | 'not-found';
  matches: Array<{
    doi: string;
    sectionPath?: string[];
    chunkOrdinal: number;
    similarity: number; // 1.0 = exact after normalization
    snippet: string;
  }>;
}
```

Exposed as a `verify-quote` MCP tool once chunks + FTS exist (phase 4).

### Backfill bridge: `index` CLI command

A one-shot command walks citations → resolves the markdown manifestation (or stem
match during transition) → hashes → chunks → populates FTS. Idempotent by
`content_hash`. On a chunker **version bump it eagerly re-chunks everything**
(decided at review — simple and correct at this corpus size;
[indexing-jobs.md](indexing-jobs.md) makes it incremental later). This is the
deliberate stepping stone before the job model re-implements it as `reindex` jobs.

### Rejected / deferred alternatives

- **Contentless FTS5**: loses `snippet()`/`highlight()`.
- **Storing a second full copy of the corpus**: the source doc's own constraint.
- **Trigram tokenizer** for identifiers/titles: no demonstrated need yet.
- **Abstract-field search**: no `abstract` column exists — blocked on the M3
  Crossref-enrichment seed item.
- **Page-marker injection or extractor swap** for page provenance: ties into the
  M4 OCR seed; revisit when the extractor changes.
- **Lazy per-document re-chunking**: rejected at review in favor of eager full
  re-chunk on version bump.

## Phasing

1. **Spike**: `CREATE VIRTUAL TABLE t USING fts5(x)` smoke test in CI on macOS
   ARM64 + Linux; go/no-go recorded here.
2. **Chunker + chunks table** (needs manifestations from domain-model phase A).
3. **FTS tables + triggers + SearchService swap** (LIKE fallback retained).
4. **`index` command + `verify-quote` MCP tool + fixture corpus + golden
   queries.**
5. **(M4) Benchmark**: index size and query latency at 1k/10k synthetic docs.

## Proposed backlog items

Milestone 3 (adopted 2026-07-12):

- [db] S - Spike: assert FTS5 available in bundled better-sqlite3 (CREATE VIRTUAL TABLE smoke test in CI, macOS ARM64 + Linux)
- [verify] S - Heading-based Markdown chunker: sectionPath from heading trail, ~2000-char max split; runs after markdown post-processing (see docs/plans/fts5-full-text-search.md)
- [db] M - chunks table (citation_id, manifestation_id, ordinal, section_path, text, content_hash) via migration runner
- [search] M - External-content FTS5 tables (chunks_fts, citations_fts; porter unicode61) with sync triggers (see docs/plans/fts5-full-text-search.md)
- [search] M - SearchService lexical mode on FTS5: bm25 ranking, snippet() highlights, section provenance; LIKE fallback pre-index
- [cli] S - `index` CLI command: one-shot (re)index into chunks + FTS; idempotent by content_hash; eager re-chunk on chunker version bump
- [test] S - Search fixture corpus + golden-query tests (phrase, stemming, unicode, section scope, filters)
- [mcp] M - MCP tool: verify-quote — normalize a quoted passage, exact-match against chunks then FTS fuzzy fallback; return section provenance or closest miss (see docs/plans/fts5-full-text-search.md)

Milestone 4 (adopted 2026-07-12):

- [test] S - FTS benchmark script: index size and query latency at 1k/10k docs, with a size-per-document budget (see docs/plans/fts5-full-text-search.md)

**Supersedes in place**: M3 `[search] L - Full-text search of extracted Markdown
content using SQLite FTS5`. **Annotates**: M3 markdown post-processing and quality
metrics seeds (chunk-quality feeders).

## Testing

- Fixture corpus: 3–4 small Markdown files — unicode text, deep heading nesting,
  table/artefact lines, plus one empty/degenerate extraction.
- Golden queries: exact phrase, porter stemming (`classifier` ↔ `classifiers`),
  unicode terms, section-scoped assertion via `section_path`, filters combined with
  MATCH, LIKE-fallback parity smoke test on an unindexed DB.
- Trigger integrity: update/delete a chunk row, assert FTS stays consistent
  (`INSERT INTO chunks_fts(chunks_fts) VALUES('integrity-check')`).
- verify-quote: exact hit; hyphenation/ligature-normalized hit; close-match via
  FTS NEAR; corpus-wide misattribution find; clean not-found.
- Growth measurement: DB size per document at 1k/10k synthetic docs (M4 item).

## Open questions

Resolved at the 2026-07-12 review:

1. Chunk max size → **~2,000 chars**, tuned against real fixture extractions
   before freezing.
2. `citations_fts` → **ships alongside chunks_fts** (both tables, one code path).
3. Re-chunk on chunker version bump → **eager full re-chunk** via the `index`
   command.

Still open:

4. Store char offsets on chunks for future exact-highlight needs, or is
   `snippet()` output sufficient? (Defaulting to `snippet()`-only until a real
   need appears.)

## Relationship to other plans

- [domain-model.md](domain-model.md) — hard dependency: manifestations + hashes.
- [service-layer.md](service-layer.md) — this plan swaps its internals; contract
  stable.
- [indexing-jobs.md](indexing-jobs.md) — replaces the one-shot `index` command's
  internals with resumable jobs.
- [vector-hybrid-search.md](vector-hybrid-search.md) — shares the `chunks` table;
  embeddings key off `content_hash`.
- [http-api.md](http-api.md) — exposes snippets/provenance via `POST /search`.
