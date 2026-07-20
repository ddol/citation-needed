# Storage adapters & external files

| Field      | Value                                                                          |
| ---------- | ------------------------------------------------------------------------------ |
| Status     | **Exploratory**: mounted paths keep working today                              |
| Flow       | Infrastructure (availability item: B)                                          |
| Depends on | [domain-model.md](domain-model.md) phase A (manifestations) and phase C (URIs) |

## Intent

Separate document identity from document location so files can live on NAS,
USB, object storage, or inside Zotero's storage without the index breaking when
they move or go offline. Honest framing: this is a **single-user local tool**,
and mounted NAS/SMB/USB paths already work as plain filesystem paths. The
near-term value is the _indirection_ and _availability tracking_, not new
protocol backends.

## Current state

- Absolute local paths everywhere: `updatePdfPath` stores them
  (`src/db/index.ts:322`), `OpenAccessDownloader` writes into a local `storageDir`,
  `extractPdfMarkdown` reads the local filesystem directly
  (`src/verification/markdown.ts:20`).
- No URI scheme, no availability tracking, no read indirection: a moved or
  unplugged volume silently breaks `pdf_path` with no marker.
- Mounted network shares and USB volumes **already work** (`/Volumes/...` is
  just a path); what's missing is graceful behavior when they vanish.
- The `url` column on citations already records the original remote source for
  many rows, a free input for the HTTPS adapter later.

## Design

### Interface

```ts
interface StorageAdapter {
  readonly type: string; // 'file' | 'https' | 's3'
  canHandle(uri: string): boolean;
  stat(uri: string): Promise<{ size: number; mtime?: string; available: boolean }>;
  openReadStream(uri: string): Promise<NodeJS.ReadableStream>;
  fingerprint?(uri: string): Promise<string>; // content hash where cheap
}
```

`resolveAccessLink` / access-context concepts are **out of the interface**
until a remote HTTP client actually exists: for loopback clients, returning
the local path is fine (raw server paths are never exposed to non-loopback API
clients).

### Phase 1: the indirection

- `LocalFileAdapter`; all PDF/Markdown reads route through it.
- Manifestation paths normalize to `file://` URIs
  ([domain-model.md](domain-model.md) phase C migration).
- Availability: `stat` refreshes `last_seen_at`; unavailable manifestations
  surface as `unavailable` in search results instead of crashing reads, and the
  `verify` CLI doubles as the location health check.

### Phase 2: HTTPS adapter

Re-fetch by the recorded `url` when the local manifestation is missing; cache
into the standard storage dir. No credentials framework.

### Phase 3: S3 adapter

`@aws-sdk/client-s3` as an **optionalDependency** (mirroring the playwright
pattern, `package.json:45`), signed short-lived links for API clients; the API
link union grows `signed-url` alongside `local-file | unavailable`.

### Rejected / deferred alternatives

- **Native SMB/NFS protocol clients**: mounted paths cover the real use.
- **Credentials framework before S3**: nothing needs it.
- **Access-link resolution / client storage mappings**: no remote clients
  exist; [http-api.md](http-api.md) rejects the same overbuild.
- **A dedicated Zotero adapter**: Zotero storage paths are local files;
  `file://` suffices ([zotero-integration.md](zotero-integration.md)).

## Phasing

1. LocalFileAdapter + `file://` normalization + availability checks.
2. HTTPS re-fetch adapter.
3. S3 adapter + signed links + `/citations/{doi}/links` endpoint.

## Backlog items (all exploratory)

Phase 1:

- [storage] M - StorageAdapter interface + LocalFileAdapter; route all PDF/markdown reads through it (see docs/plans/storage-adapters.md)
- [db] S - Normalize manifestation paths to file:// URIs (migration + write-path change)
- [storage] S - Availability checks: last_seen_at refresh, unavailable status surfaced in search results and `verify` CLI

Phases 2–3:

- [storage] M - HTTPS adapter: re-fetch by recorded url with cache check
- [storage] L - S3 adapter as optionalDependency (@aws-sdk/client-s3) with signed short-lived links
- [api] S - GET /api/v1/citations/{doi}/links returning resolved links (local-file | unavailable, later signed-url)

## Testing

- Adapter contract test suite, run against every adapter implementation.
- Missing-file fixture: manifestation whose path doesn't resolve →
  `unavailable` in stat, search result marker, `verify` output.
- Unplugged-volume simulation: rename a fixture directory mid-test; assert
  graceful degradation and `last_seen_at` retained.
- URI round-trip: absolute paths with spaces/unicode survive `file://`
  normalization and back.

## Open questions

1. URI normalization details for existing absolute paths (percent-encoding,
   `/Volumes` case sensitivity), worth a tiny spike before the migration.
2. Does availability checking run inline in search (cost per result) or only
   via `verify` / background jobs, with search reading the cached status?
3. Is phase 2 (HTTPS re-fetch) actually wanted, or does the retrieval
   orchestrator already cover re-download well enough that the adapter adds
   nothing?

## Relationship to other plans

- [domain-model.md](domain-model.md): provides manifestations (phase A) and
  the URI migration slot (phase C).
- [http-api.md](http-api.md): consumes the link union for
  `/citations/{doi}/links`; enforces the no-raw-paths-to-remote-clients rule.
- [zotero-integration.md](zotero-integration.md): attachment linking produces
  `file://` locations this plan then health-checks.
- [indexing-jobs.md](indexing-jobs.md): availability refresh is a natural
  background job kind.
- [fts5-full-text-search.md](fts5-full-text-search.md): unaffected; chunks
  persist even when the source file is offline (never silently deleted).
