# Domain model & schema evolution

| Field      | Value                                                       |
| ---------- | ----------------------------------------------------------- |
| Status     | **Core: slices 2, 3 shipped** (phases B/C exploratory)      |
| Flow       | Infrastructure (serves A, B, C)                             |
| Depends on | None (schema foundation for fts5, zotero, storage-adapters) |

## Intent

Separate "the scholarly work" from "a file that represents it" and "an
identifier that names it", using the **minimum migration** and no renames. This
unblocks tracked Markdown extraction (FTS5), Zotero attachments as first-class
files, and multiple files per paper, while preserving every existing record,
query, and tool.

## Current state

- Phase A is live: versioned migration runner (`src/db/migrations.ts`,
  `PRAGMA user_version`; the three ad-hoc migrators run first as idempotent
  bootstrap), `manifestations` table owning file locations, `Database` deriving
  `Citation.pdfPath` from the pdf manifestation with
  `COALESCE(manifestation.path, pdf_path)`, transition dual-write of
  `pdf_path`, sha256 hashing at write time (`src/utils/hash.ts`), and
  import-time provenance recording (`src/workflows/process-bibtex.ts`).
- Legacy-DB backfill is not a migration: manifestation rows for files that
  predate the table appear when `citation-needed index` walks the corpus
  (`src/services/indexer.ts`) or an import touches the row.
- **Readers still bypass manifestations.** `resolveMarkdownPath`
  (`src/services/markdown-locator.ts`) locates extracted Markdown by the
  pdf-path-sibling stem heuristic, so:
  - imports with a custom `--markdown-path` produce content that
    `read-content`, `verify-quote`, and `index` cannot find, even though the
    manifestation row records the true path;
  - a citation with Markdown but no `pdfPath` is unreadable (the locator
    returns null immediately);
  - the source of truth is written but never read.
- `citations` (`src/db/schema.ts:22`) remains the document table:
  - `doi TEXT UNIQUE` is the identity; both import paths hard-skip DOI-less
    entries, so DOI-less documents are **unrepresentable** (phase B).
  - `bibtex_key` is an inline column: a second identifier scheme squatting in
    the row (phase B).
- `retrieval_log` (`src/db/schema.ts:45`) already cleanly separates the
  download-attempt entity.
- Every SQL read/write goes through the `Database` class, the single
  chokepoint that keeps the adapter approach cheap.

## Design

Adopt the _distinctions_ without renames: `citations` remains the document
table (renaming to `documents` is rejected as destructive to every query, test,
and tool for zero user-visible gain).

### Phase A: migration runner + manifestations (core)

A minimal versioned runner, not a framework (~40 lines):

```ts
// src/db/migrations.ts
interface Migration {
  version: number; // PRAGMA user_version after applying
  name: string;
  up(db: BetterSqlite3.Database): void;
}

export const migrations: Migration[] = [
  /* ordered */
];

export function runMigrations(db: BetterSqlite3.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (const m of migrations.filter((m) => m.version > current)) {
    db.transaction(() => {
      m.up(db);
      db.pragma(`user_version = ${m.version}`);
    })();
  }
}
```

The three existing ad-hoc migrators keep running before the versioned steps as
"bootstrap" (they are idempotent by construction); new schema changes go through
`migrations` only.

```sql
CREATE TABLE manifestations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  citation_id INTEGER NOT NULL REFERENCES citations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('pdf', 'markdown-extracted')),
  path TEXT NOT NULL,
  content_hash TEXT,
  extractor_name TEXT,
  extractor_version TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  UNIQUE (citation_id, kind, path)
);
CREATE INDEX idx_manifestations_citation_id ON manifestations (citation_id);
```

- **Single source of truth**: manifestations own file locations, and the
  `Database` class is the adapter. Reads derive `Citation.pdfPath` from the pdf
  manifestation (join, with `COALESCE(manifestation.path, pdf_path)` during the
  transition), so the external MCP contract is unchanged; `updatePdfPath`
  upserts the manifestation row. The legacy `citations.pdf_path` column is
  still **written for one transition release** (downgrade safety), then goes
  dormant, kept in the schema forever but never read or written by new code.
- **Backfill**: one-shot walk over existing `pdf_path` values (existence-checked)
  plus stem-matched `papers/markdown/` files; hash what exists.
- **Hashing at write time**: streaming sha256 helper (`src/utils/hash.ts`);
  `processBibtexFile` hashes PDFs and Markdown as they are written, backfill
  covers legacy files. Hashes are what make incremental indexing and
  re-embedding invalidation possible later
  ([indexing-jobs.md](indexing-jobs.md),
  [vector-hybrid-search.md](vector-hybrid-search.md)).

### Phase A2: manifestation-first reads (shipped, slice 3)

`resolveMarkdownPath` stays the single content-resolution chokepoint but gains
the `Database`: resolve `manifestations(kind = 'markdown-extracted')` first
(existence-checked; newest row wins, which `Database.getManifestation` already
implements), falling back to the stem heuristic only for legacy databases
whose rows predate manifestations. A fallback hit **self-heals** by upserting
the manifestation row it just found, so every successful legacy read converges
the database toward full manifestation coverage.

The `pdfPath` precondition disappears: markdown-only citations resolve. The
locator remains the seam where [storage-adapters.md](storage-adapters.md)
phase 1 later routes reads through `LocalFileAdapter`.

**Fallback removal criterion**: once a release has shipped with self-healing
reads plus the `index` backfill walk, and fallback hits have stopped appearing
in logs, the stem heuristic is deleted (`getCitationFileStem` remains for
write-side naming only).

### Phase B: identifiers (exploratory)

```sql
CREATE TABLE identifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  citation_id INTEGER NOT NULL REFERENCES citations(id) ON DELETE CASCADE,
  scheme TEXT NOT NULL CHECK (scheme IN ('arxiv', 'pmid', 'zotero-key', 'zotero-library', 'bibtex-key')),
  value TEXT NOT NULL,
  UNIQUE (scheme, value)
);
```

DOI deliberately **stays on `citations.doi`**: it is the UPSERT key for every
lookup and write; moving it is high-risk, low-reward. `bibtex_key` column stays
for compatibility; `identifiers` adds cross-scheme lookup on top.
[citation-graph.md](citation-graph.md) extends the scheme CHECK with
`semantic-scholar-id` / `openalex-id` for cross-source graph dedupe.

**DOI-less admission** (exploratory, paired with Zotero import): relax the
DOI-required import guards; identity for DOI-less items comes from
`identifiers` (zotero-key / bibtex-key) plus a generated internal ID when no
external identifier exists at all.

### Phase C: locations as URIs (exploratory)

`manifestations.path` migrates to URI form (`file:///…`) when
[storage-adapters.md](storage-adapters.md) lands. A separate `locations` table
is rejected until a single manifestation genuinely lives at two places.

### Rejected / deferred alternatives

- **Renaming `citations` → `documents`**: destructive for zero user gain.
- **Moving DOI into `identifiers`**: breaks the UPSERT identity everywhere.
- **Dual-write forever**: manifestations are the single source; `pdf_path`
  writes are transition-only, then the column is dormant.
- **A first-class Index Artifact table**: chunks and embeddings live in their
  own plans and serve this role.
- **Markdown research notes as first-class documents**: revisit once DOI-less
  admission is in and real demand appears.
- **Separate `locations` table**: premature; revisit with multi-location
  evidence.

## Phasing

1. **A (core, slice 2, shipped)**: migration runner → manifestations table →
   adapter reads + transition write → backfill → write-time hashing.
2. **A2 (shipped, slice 3)**: manifestation-first locator with self-healing stem
   fallback → fallback deletion once trusted.
3. **B (exploratory)**: identifiers table + DOI-less admission, populated by
   [zotero-integration.md](zotero-integration.md) and arXiv IDs known at
   resolve time.
4. **C (exploratory)**: path → URI migration with storage adapters.

## Backlog items

Core slice 2 (shipped; see BACKLOG.md § Completed):

- [db] M - Versioned migration runner (PRAGMA user_version + ordered steps in src/db/migrations.ts); existing ad-hoc migrators become bootstrap (see docs/plans/domain-model.md)
- [db] M - manifestations table as single source of truth for files; Database class derives Citation.pdfPath; pdf_path dormant after one transition release (see docs/plans/domain-model.md)
- [db] S - Backfill manifestations from existing pdf_path values and papers/markdown/ stems
- [util] S - Streaming sha256 content-hash helper; hash PDFs and Markdown at write time (see docs/plans/domain-model.md)

Core slice 3:

- [storage] S - Manifestation-first content resolution: markdown-locator reads manifestations(kind='markdown-extracted') via Database, existence-checked; legacy stem fallback self-heals a manifestation row on hit (see docs/plans/domain-model.md)
- [test] S - Locator coverage: custom --markdown-path import readable via MCP, markdown-only manifestation, manifestation row with missing file (see docs/plans/domain-model.md)

Exploratory:

- [db] M - identifiers table (scheme+value UNIQUE); DOI stays on citations
- [db] M - Admit DOI-less citations: relax import guards; identity via identifiers + generated internal id
- [db] S - identifiers schemes += semantic-scholar-id, openalex-id

## Testing

- Migration tests: fresh DB reaches target `user_version`; legacy-DB fixture
  (pre-CHECK schema) migrates with data intact; runner is idempotent on
  re-open.
- Adapter consistency: `updatePdfPath` ⇒ manifestation row present; derived
  `Citation.pdfPath` matches for pre- and post-backfill rows (COALESCE path).
- Backfill idempotency: second run inserts zero rows.
- Transition-window test: pdf_path column still written in the transition
  release; dormant (unchanged) afterwards.
- Hash helper: known-vector test + large-file streaming test.
- Locator (slice 3): manifestation row wins over stem candidates; custom
  markdown-dir fixture resolves; markdown-only citation (no pdfPath) resolves;
  manifestation whose file is deleted degrades without crashing; a fallback
  hit upserts the row (second read is served from manifestations).

## Open questions

None currently.

## Relationship to other plans

- [fts5-full-text-search.md](fts5-full-text-search.md): requires phase A
  (manifestations + hashes) before chunking.
- [service-layer.md](service-layer.md): read-content, verify-quote, and the
  indexer all resolve content through the phase-A2 locator.
- [zotero-integration.md](zotero-integration.md): needs phase B (identifiers);
  attachment linking writes manifestations.
- [storage-adapters.md](storage-adapters.md): drives phase C (URIs,
  `last_seen_at` availability).
- [indexing-jobs.md](indexing-jobs.md): stores per-stage provenance on
  manifestations/chunks rows.
- [citation-graph.md](citation-graph.md): its edges/corpus_status migration
  runs on this runner; adds identifier schemes.
