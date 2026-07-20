# Indexing jobs & incremental processing

| Field      | Value                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Status     | **Exploratory**: revisit when core-loop usage demands concurrency/resume                                                         |
| Flow       | Infrastructure                                                                                                                   |
| Depends on | [domain-model.md](domain-model.md) phase A (hashes); [fts5-full-text-search.md](fts5-full-text-search.md) for chunk/index stages |

## Intent

Make processing asynchronous, restartable, and incremental: a SQLite-backed job
queue with an in-process worker loop, staged pipeline steps, and
content-hash-based skip rules so the corpus is never reprocessed wholesale.
Three related backlog items (concurrent downloads, resume, watch mode) are
facets of this one model rather than three separate mechanisms.

## Current state

- `processBibtexFile` (`src/workflows/process-bibtex.ts:58`) is a synchronous
  sequential loop: per-entry `onProgress` callbacks, failures collected in-memory,
  one `retrieval_log` row per attempt as the only durable record.
- No job table, no resume, no concurrency, no watch mode.
- The only cache is the pre-download check for an existing local PDF inside
  `RetrievalOrchestrator` (DB `pdfPath` + file existence).
- No job abstraction exists anywhere in the codebase.

## Design

### Jobs table + worker loop

```sql
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,            -- 'import-entry' | 'reindex-citation' | …
  payload TEXT NOT NULL,         -- JSON, small: identifiers + options only
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX idx_jobs_status ON jobs (status, id);
```

An in-process worker loop claims `queued` jobs (single `UPDATE … WHERE id IN
(SELECT …) RETURNING`), runs them through a simple promise pool with a
configurable concurrency limit, and marks `done`/`failed` with `attempts`
incremented. Granularity: **one job per entry** with a `batch_id` payload field
grouping them for reporting: fine-grained resume, natural concurrency unit.
Retry: up to **3 automatic attempts with exponential backoff** for transient
failures, then `failed` until an explicit `jobs retry`. Startup recovery:
`running` jobs older than a threshold reset to `queued`.

### Stages

Five stages, matching what exists or is planned:

```
resolve → download → extract → chunk → fts-index
```

`embed` joins via [vector-hybrid-search.md](vector-hybrid-search.md);
`classify` / `summarize` have no plan and stay out of scope. The stage list is
data, so it extends without migration: snowball expansion and trend runs from
[citation-graph.md](citation-graph.md) arrive as additional job kinds, while
_scheduling_ of trends stays external (cron; no scheduler in the core).

Per-stage provenance (input hash, processor name + version, timestamps, error)
lives on the `manifestations`/`chunks` rows the stage produces, not duplicated
into job payloads. Jobs are the _coordination_ record; artifacts are the
_provenance_ record.

### Incremental rules

- Unchanged `content_hash` short-circuits extract/chunk/index.
- Extractor or chunker **version bump invalidates downstream stages only**
  (bump chunker ⇒ re-chunk + re-index, no re-download).
- Path change with same hash **re-links** the manifestation; nothing recomputes,
  and (later) embeddings are never regenerated for a move.
- Deleted/unavailable files mark the manifestation (`last_seen_at`, status);
  chunks are never silently deleted.

### Progress display

Once imports run as jobs, the Ink `ImportProgress` TUI reads the jobs table
(polling) instead of in-memory callbacks: one source of truth, progress
survives restarts, and externally-enqueued work (watch mode) is visible too.

### Related backlog items expressed through this model

| Item                              | Becomes                                        |
| --------------------------------- | ---------------------------------------------- |
| Concurrent/parallel PDF downloads | worker-pool concurrency limit on download jobs |
| Resume interrupted batch import   | job state replay on restart                    |
| `watch` mode for new .bib files   | filesystem watcher that _enqueues_ import jobs |

The OCR item becomes a future `extract`-stage variant (different extractor
name/version; the provenance model already accommodates it).

### Rejected / deferred alternatives

- **External queue frameworks** (BullMQ/Redis, pg-boss, etc.): a SQLite job
  table + worker loop is sufficient at this scale.
- **Drain-and-exit worker + external cron scheduling**: considered; the
  in-process loop is retained. Trend _scheduling_ stays external regardless.
- **A separate daemon process**: in-process; the MCP server or CLI command
  hosts the loop.
- **classify/summarize stages**: no consumer, LLM enrichment is out of scope.
- **Storing stage provenance in job payloads**: duplicates what
  manifestations/chunks already record.
- **Per-batch jobs**: per-entry + `batch_id` instead.

## Phasing

1. **Jobs table + worker loop + `import-entry` kind**: `processBibtexFile`
   becomes enqueue + drain, gaining resume and concurrency in one step;
   `ImportProgress` switches to reading the jobs table.
2. **`reindex-citation` kind**: the `index` CLI command from
   [fts5-full-text-search.md](fts5-full-text-search.md) re-implemented as jobs;
   incremental rules enforced here.
3. **Watch producer**: fs watcher enqueues import jobs.

## Backlog items (all exploratory)

- [flow] M - jobs table (kind, payload, status, attempts, last_error) + in-process worker loop; per-entry jobs with batch_id; 3 auto-retries with backoff then manual (see docs/plans/indexing-jobs.md)
- [flow] M - Stage-based pipeline (resolve → download → extract → chunk → fts-index) with per-stage provenance on manifestations/chunks (see docs/plans/indexing-jobs.md)
- [flow] S - Incremental re-index rules: skip unchanged content_hash; extractor/chunker version bump invalidates downstream stages only
- [flow] L - Concurrent PDF downloads via job worker pool with configurable concurrency limit
- [flow] M - Resume interrupted imports via persisted job state
- [flow] L - `watch` mode as filesystem-watcher job producer
- [cli] S - `jobs` CLI command: list, status, retry failed
- [tui] S - ImportProgress reads the jobs table for progress
- [test] M - Crash-resume and idempotency tests: kill worker mid-batch → restart completes without re-downloading; rerun produces zero new work

## Testing

- Crash-resume: enqueue N entries, kill the worker mid-batch, restart, assert
  all reach `done` with no duplicate downloads (cache check respected).
- Idempotency: run the full pipeline twice; second run performs zero stage work
  (hash short-circuit observed via provenance timestamps).
- Version-bump invalidation: bump chunker version, assert re-chunk + re-index
  run while download/extract are skipped.
- Retry: transient failure succeeds on attempt ≤ 3; persistent failure lands in
  `failed` with `attempts = 3` and surfaces in `jobs` CLI.
- Stuck-job recovery: `running` job older than threshold is reclaimed on
  startup.

## Open questions

None currently.

## Relationship to other plans

- [domain-model.md](domain-model.md): provides the hashes and manifestation
  rows the incremental rules key on.
- [fts5-full-text-search.md](fts5-full-text-search.md): its one-shot `index`
  command ships first and is deliberately absorbed here later.
- [vector-hybrid-search.md](vector-hybrid-search.md): adds the `embed` stage.
- [zotero-integration.md](zotero-integration.md): local-API incremental import
  would enqueue jobs rather than run inline.
- [citation-graph.md](citation-graph.md): snowball expansion and trend runs
  execute as job kinds on this loop; scheduling stays external.
- [service-layer.md](service-layer.md): orthogonal; a future JobService could
  expose job status through MCP/HTTP if needed.
