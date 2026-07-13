# Vector & Hybrid Search

| Field         | Value                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status        | **Deferred** — revisit after FTS5 lands and real search quality is observed                                                                                                                       |
| Work-stream   | A — Grounded Answers (future enhancement)                                                                                                                                                         |
| Depends on    | [fts5-full-text-search.md](fts5-full-text-search.md) (chunks), [service-layer.md](service-layer.md) (mode union), [indexing-jobs.md](indexing-jobs.md) (embed stage), persistent config file item |
| Last reviewed | 2026-07-12                                                                                                                                                                                        |

## Intent

Optional semantic search over chunk embeddings, fused with lexical results by a
transparent, deterministic method. **Optional is structural**: the system must
run fully — import, extract, FTS search, API — with vectors absent, no
embedding provider configured, and no vector dependency installed. This doc
parks a vetted design; its purpose is _not_ to schedule work.

## Current state

- Nothing exists: no embeddings, no vector dependencies, no `mode` beyond
  `'lexical'` in the SearchService contract (reserved for exactly this widening).
- The `chunks` table arrives with [fts5-full-text-search.md](fts5-full-text-search.md);
  `content_hash` per chunk arrives with it (the invalidation key).

## Design

### EmbeddingStore behind an interface, flat table first

```sql
CREATE TABLE embeddings (
  chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  model_version TEXT NOT NULL,
  dims INTEGER NOT NULL,
  vector BLOB NOT NULL, -- little-endian float32 array
  content_hash TEXT NOT NULL,
  PRIMARY KEY (chunk_id, model, model_version)
);
```

Brute-force cosine over `Float32Array` in JS. This is genuinely sufficient below
~50k chunks (department-scale corpus) with **zero new dependencies** — measure
before optimizing.

**sqlite-vec** is the upgrade path when latency demands it, gated on a spike
checklist: Node bindings quality, `loadExtension` with better-sqlite3, macOS
ARM64 prebuilds, behavior under migration/dump/restore, filtered queries
alongside vector match, project maintenance. Go/no-go recorded here after the
spike.

### Embedding provider is config, not code

`none | ollama | openai-compatible` (persistent config file). Default `none`:
every feature works, `capabilities.vectorSearch` stays `false`. Local-first
bias: ollama endpoint before any hosted API.

### Hybrid mode: reciprocal-rank fusion

`mode: 'lexical' | 'semantic' | 'hybrid'` in SearchService. Hybrid = RRF
(`k = 60`) over the lexical and semantic rank lists — transparent, deterministic,
no tuning treadmill. Scores reported per source
(`scores: { combined, lexical?, semantic? }`).

### Invalidation

Embeddings key on `(content_hash, model, model_version)`:

- Path moves / re-links **never** re-embed (satisfied via domain-model hashes).
- Chunker version bump changes hashes → re-embed only changed chunks.
- Model change adds rows alongside old ones; old model rows are garbage-collected
  explicitly, never silently.

### Rejected / deferred alternatives

- **LanceDB / Qdrant / pgvector**: operational complexity unjustified at this
  scale; pgvector only becomes relevant if SQLite itself is outgrown.
- **LLM re-ranking in the core search path**: the core stays deterministic.
- **Doc-level abstract embeddings in v1**: no abstract column yet (Crossref
  enrichment item); chunk embeddings subsume most value.
- **Quantization**: premature below memory pressure.

## Phasing

1. EmbeddingStore + flat table + cosine + `semantic` mode (provider `none` ⇒
   feature dark).
2. `hybrid` mode with RRF; capabilities flip.
3. sqlite-vec spike; adopt only on a clear latency win.

## Backlog items (parked — merge into BACKLOG.md only if this plan is adopted)

- [search] M - EmbeddingStore interface + flat embeddings table (chunk_id, model, model_version, dims, vector BLOB) + brute-force cosine (see docs/plans/vector-hybrid-search.md)
- [cfg] S - Embedding provider config (none | ollama | openai-compatible); none default, all features work without vectors
- [search] M - semantic + hybrid SearchService modes with reciprocal-rank fusion; per-source scores
- [flow] M - embed job stage keyed by (content_hash, model, model_version); path moves never re-embed
- [search] S - Spike: sqlite-vec via better-sqlite3 loadExtension on macOS ARM64; go/no-go recorded in this doc
- [test] S - Recall spot-check query set + hybrid-vs-lexical regression + latency budget vs FTS-only baseline

## Testing

- Recall spot-checks: ~10 curated queries with expected papers (fixture corpus +
  a deterministic fake embedder for CI; real-model checks stay manual).
- Hybrid regression: hybrid must never rank a curated exact-phrase match below
  its lexical-only position beyond a set tolerance.
- Latency budget: semantic and hybrid within N× the FTS-only baseline at 10k
  chunks (budget set after first measurement).
- Absence tests: provider `none` ⇒ `semantic`/`hybrid` requests fail with a clear
  capability error; everything else unaffected.

## Open questions

1. Default local model (via ollama): `nomic-embed-text` vs `all-MiniLM` class —
   decide at spike time, not now.
2. Embed title+journal as a pseudo-chunk per citation for metadata-semantic
   matching, or chunks only?
3. GC policy for stale model rows: explicit CLI (`index --prune-embeddings`) or
   automatic on model switch?

## Relationship to other plans

- [fts5-full-text-search.md](fts5-full-text-search.md) — provides chunks +
  content hashes; lexical rank list for RRF.
- [service-layer.md](service-layer.md) — mode union widens; contract otherwise
  stable.
- [indexing-jobs.md](indexing-jobs.md) — `embed` becomes a pipeline stage with
  standard provenance.
- [http-api.md](http-api.md) — `capabilities.vectorSearch` flips; same `/search`
  endpoint.
- [domain-model.md](domain-model.md) — hashes underpin invalidation.
