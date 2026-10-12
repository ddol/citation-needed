# Indexing jobs & incremental processing

| Field      | Value                                                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status     | **Core: slice 5** for the jobs table, worker, stage resume, and event bus that dossier jobs run on; import, reindex, and watch job kinds stay exploratory |
| Flow       | Infrastructure (serves Dossier)                                                                                                                           |
| Depends on | [domain-model.md](domain-model.md) phase A (hashes); [fts5-full-text-search.md](fts5-full-text-search.md) for chunk/index stages                          |

## Intent

Make processing asynchronous, restartable, and incremental: a SQLite-backed job
queue with an in-process worker loop, staged pipeline steps, and
content-hash-based skip rules so nothing is reprocessed wholesale.

The first consumer is the dossier: a long, multi-stage job that spends money on
model calls, must survive a restart without paying twice, and reports progress
to the web UI. Imports, reindexing, concurrent downloads, and watch mode are
later job kinds on the same loop rather than separate mechanisms.

## Current state

- `processBibtexFile` (`src/workflows/process-bibtex.ts`) is a synchronous
  sequential loop: per-entry `onProgress` callbacks, failures collected
  in-memory, one `retrieval_log` row per attempt as the only durable record.
- No job table, no resume, no concurrency, no watch mode.
- The only cache is the pre-download check for an existing local PDF inside
  `RetrievalOrchestrator`.

## Design

### Jobs table + worker loop

```sql
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,            -- 'dossier' | 'import-entry' | 'reindex-citation' | …
  payload TEXT NOT NULL,         -- JSON, small: identifiers + options only
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'paused', 'done', 'failed', 'cancelled')),
  stage TEXT,                    -- current stage, for display and resume
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX idx_jobs_status ON jobs (status, id);
```

An in-process worker loop claims `queued` jobs (single `UPDATE … WHERE id IN
(SELECT …) RETURNING`), runs them through a promise pool with a configurable
concurrency limit, and marks them `done` or `failed` with `attempts`
incremented. `serve` hosts the loop. Retry: up to **3 automatic attempts with
exponential backoff** for transient failures, then `failed` until an explicit
retry. `paused` is set by the worker when a dossier reaches its token cap or needs the
user's disclosure confirmation, and cleared only by the user. Startup recovery: `running` jobs older than a
threshold reset to `queued`.

Granularity: **one job per dossier**, and later one job per import entry with a
`batch_id` payload field grouping entries for reporting.

### Stages

The stage list is data per job kind, so new kinds extend it without migration.

| Kind               | Stages                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `dossier`          | acquire → extract → profile → disclose → rasterize → math → figures → read → compose → check → render (see [dossier.md](dossier.md)) |
| `import-entry`     | resolve → download → extract → chunk → fts-index                                                                                     |
| `reindex-citation` | chunk → fts-index                                                                                                                    |

`embed` joins via [vector-hybrid-search.md](vector-hybrid-search.md). Snowball
expansion and trend runs from [citation-graph.md](citation-graph.md) arrive as
further kinds, while _scheduling_ trends stays external (cron; no scheduler in
the core).

Jobs are the _coordination_ record; artifacts are the _provenance_ record.
Per-stage provenance (input hash, processor name and version, timestamps,
error) lives on the rows a stage produces (`manifestations`, `chunks`,
`dossier_parts`, `model_runs`), never duplicated into job payloads. A dossier
stage resumes by reading which of its parts already exist with a matching input
hash.

### Incremental rules

- Unchanged `content_hash` short-circuits extract, chunk, and index.
- An extractor or chunker **version bump invalidates downstream stages only**
  (bump the chunker: re-chunk and re-index, no re-download).
- A prompt-set hash change invalidates the model stages that use that prompt,
  and nothing upstream of them.
- A model call matching a prior `ok` run on provider, model, prompt hash, input
  hash, and temperature reuses its output ([model-providers.md](model-providers.md)).
- A path change with the same hash **re-links** the manifestation; nothing
  recomputes.
- Deleted or unavailable files mark the manifestation (`last_seen_at`, status);
  chunks are never silently deleted.

### Progress events

The worker writes progress to one in-process event bus: `stage-started`,
`item-finished`, `model-run`, `stage-finished`, `job-paused` (budget or
disclosure), `job-finished`.
The web UI streams it over SSE ([web-ui.md](web-ui.md)); `ImportProgress` reads
the same bus once imports run as jobs. Persisted rows stay the source of truth;
the bus only makes changes arrive sooner.

### Related backlog items expressed through this model

| Item                              | Becomes                                        |
| --------------------------------- | ---------------------------------------------- |
| Dossier generation                | `dossier` job kind with resumable stages       |
| Concurrent/parallel PDF downloads | worker-pool concurrency limit on download jobs |
| Resume interrupted batch import   | job state replay on restart                    |
| `watch` mode for new .bib files   | filesystem watcher that _enqueues_ import jobs |

### Rejected / deferred alternatives

- **External queue frameworks** (BullMQ/Redis, pg-boss): a SQLite job table and
  worker loop suffice at this scale.
- **Drain-and-exit worker + external cron scheduling**: the in-process loop is
  retained. Trend _scheduling_ stays external regardless.
- **A separate daemon process**: in-process; `serve` (and later the MCP server
  or a CLI command) hosts the loop.
- **Storing stage provenance in job payloads**: duplicates what the produced
  rows already record.
- **One job per dossier stage**: stages share state (the profile, region list,
  and budgets); one job with a resumable stage cursor keeps that state in one
  place.

## Phasing

1. **Core, slice 5**: jobs table, worker loop hosted by `serve`, `dossier` kind
   with stage resume, pause on token cap, event bus.
2. **`import-entry` kind**: `processBibtexFile` becomes enqueue and drain,
   gaining resume and concurrency in one step; `ImportProgress` reads the bus.
3. **`reindex-citation` kind**: the `index` CLI command re-implemented as jobs;
   incremental rules enforced here.
4. **Watch producer**: a filesystem watcher enqueues import jobs.

## Backlog items

Core (slice 5):

- [flow] M - jobs table (kind, payload, status incl. paused/cancelled, stage, attempts, last_error) + in-process worker loop hosted by serve; 3 auto-retries with backoff then manual (see docs/plans/indexing-jobs.md)
- [flow] M - dossier job kind: stage cursor, resume from persisted dossier_parts by input hash, pause on token cap or pending disclosure (see docs/plans/indexing-jobs.md)
- [flow] S - Progress event bus: stage, item, model-run, pause, and finish events; persisted rows stay the source of truth (see docs/plans/indexing-jobs.md)
- [test] M - Crash-resume and idempotency tests: kill the worker mid-dossier, restart completes without repeating finished model calls; a rerun makes zero calls (see docs/plans/indexing-jobs.md)

Exploratory:

- [flow] M - import-entry job kind: processBibtexFile becomes enqueue + drain; per-entry jobs with batch_id (see docs/plans/indexing-jobs.md)
- [flow] S - Incremental re-index rules: skip unchanged content_hash; extractor/chunker version bump invalidates downstream stages only
- [flow] L - Concurrent PDF downloads via job worker pool with configurable concurrency limit
- [flow] M - Resume interrupted imports via persisted job state
- [flow] L - `watch` mode as filesystem-watcher job producer
- [cli] S - `jobs` CLI command: list, status, retry failed
- [tui] S - ImportProgress reads the event bus for progress

## Testing

- Crash-resume: start a dossier against scripted model fixtures, kill the
  worker mid-stage, restart, assert the job reaches `done` and no finished model
  call repeats.
- Idempotency: run a dossier twice; the second run makes zero model calls
  (output reuse observed through `model_runs`).
- Invalidation: change one role's prompt; only that stage and its dependents
  rerun.
- Budget: a job crossing its token cap lands in `paused` before the call that
  would cross it; resume with a raised cap completes.
- Retry: a transient failure succeeds on attempt ≤ 3; a persistent failure lands
  in `failed` with `attempts = 3`.
- Stuck-job recovery: a `running` job older than the threshold is reclaimed on
  startup.

## Open questions

None currently.

## Relationship to other plans

- [dossier.md](dossier.md): the first job kind and its stages.
- [web-ui.md](web-ui.md): streams the event bus and offers job control.
- [model-providers.md](model-providers.md): output reuse and the token cap.
- [domain-model.md](domain-model.md): provides the hashes and manifestation
  rows the incremental rules key on.
- [fts5-full-text-search.md](fts5-full-text-search.md): its one-shot `index`
  command is absorbed here later.
- [vector-hybrid-search.md](vector-hybrid-search.md): adds the `embed` stage.
- [zotero-integration.md](zotero-integration.md): local-API incremental import
  would enqueue jobs rather than run inline.
- [citation-graph.md](citation-graph.md): snowball expansion and trend runs
  execute as job kinds on this loop; scheduling stays external.
