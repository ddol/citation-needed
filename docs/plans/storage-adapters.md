# Storage Adapters & External Files

| Field         | Value                                                                          |
| ------------- | ------------------------------------------------------------------------------ |
| Status        | **Adopted — phase 1 only** (2026-07-12 review); phases 2–3 parked in-doc       |
| Milestone(s)  | M6                                                                             |
| Work-stream   | E — Platform & Scale (availability item: B — Trust & Verification)             |
| Depends on    | [domain-model.md](domain-model.md) phase A (manifestations) and phase C (URIs) |
| Absorbs       | Source exploration §6, §16, Phases 4 + 7; decision questions 10, 11            |
| Last reviewed | 2026-07-12                                                                     |

## Intent

Separate document identity from document location so files can live on NAS, USB,
object storage, or inside Zotero's storage without the index breaking when they
move or go offline. Honest framing: this is a **single-user local tool** today, and
mounted NAS/SMB/USB paths already work as plain filesystem paths — the source doc
itself recommends treating them that way. The near-term value is the _indirection_
and _availability tracking_, not new protocol backends.

## Current state

- Absolute local paths everywhere: `updatePdfPath` stores them
  (`src/db/index.ts:322`), `OpenAccessDownloader` writes into a local `storageDir`,
  `extractPdfMarkdown` reads the local filesystem directly
  (`src/verification/markdown.ts:20`).
- No URI scheme, no availability tracking, no read indirection — a moved or
  unplugged volume silently breaks `pdf_path` with no marker.
- Mounted network shares and USB volumes **already work** (`/Volumes/...` is just a
  path); what's missing is graceful behavior when they vanish.
- The `url` column on citations already records the original remote source for
  many rows — a free input for the HTTPS adapter later.

## Design

### Interface (trimmed from source §6)

```ts
interface StorageAdapter {
  readonly type: string; // 'file' | 'https' | 's3'
  canHandle(uri: string): boolean;
  stat(uri: string): Promise<{ size: number; mtime?: string; available: boolean }>;
  openReadStream(uri: string): Promise<NodeJS.ReadableStream>;
  fingerprint?(uri: string): Promise<string>; // content hash where cheap
}
```

`resolveAccessLink` and `AccessContext` from the source doc are **dropped from the
interface** until a remote HTTP client actually exists — for loopback clients,
returning the local path is fine (documented distinction: raw server paths are
never exposed to non-loopback API clients).

### Phase 1 — the indirection (adopted; the only near-term part)

- `LocalFileAdapter`; all PDF/Markdown reads route through it.
- Manifestation paths normalize to `file://` URIs
  ([domain-model.md](domain-model.md) phase C migration).
- Availability: `stat` refreshes `last_seen_at`; unavailable manifestations surface
  as `unavailable` in search results instead of crashing reads (source Q11), and
  the existing M3 `verify` CLI seed doubles as the location health check.

### Phase 2 — HTTPS adapter (parked at review)

Re-fetch by the recorded `url` when the local manifestation is missing; cache into
the standard storage dir. No credentials framework.

### Phase 3 — S3 adapter (parked at review)

`@aws-sdk/client-s3` as an **optionalDependency** (mirroring the playwright
pattern, `package.json:45`), signed short-lived links for API clients; the API
link union grows `signed-url` alongside `local-file | unavailable`.

### Rejected / deferred alternatives

- **Native SMB/NFS protocol clients**: mounted paths cover the real use; permanent
  rejection until proven otherwise.
- **Credentials framework before S3**: nothing needs it.
- **`resolveAccessLink`/`AccessContext`/client storage mappings**: no remote
  clients exist; [http-api.md](http-api.md) rejects the same overbuild.
- **A dedicated Zotero adapter**: Zotero storage paths are local files;
  `file://` suffices ([zotero-integration.md](zotero-integration.md)).

## Phasing

1. **M6-a (adopted)**: LocalFileAdapter + `file://` normalization + availability
   checks.
2. **M6-b (parked)**: HTTPS re-fetch adapter.
3. **M6-c (parked)**: S3 adapter + signed links + `/citations/{doi}/links`
   endpoint.

## Proposed backlog items

Milestone 6 (adopted 2026-07-12 — phase 1 only):

- [storage] M - StorageAdapter interface + LocalFileAdapter; route all PDF/markdown reads through it (see docs/plans/storage-adapters.md)
- [db] S - Normalize manifestation paths to file:// URIs (migration + write-path change)
- [storage] S - Availability checks: last_seen_at refresh, unavailable status surfaced in search results and `verify` CLI

Parked in-doc (phases 2–3; merge into BACKLOG.md only when a real need appears):

- [storage] M - HTTPS adapter: re-fetch by recorded url with cache check
- [storage] L - S3 adapter as optionalDependency (@aws-sdk/client-s3) with signed short-lived links
- [api] S - GET /api/v1/citations/{doi}/links returning resolved links (local-file | unavailable, later signed-url)

**Annotates**: the M3 `[cli] M - verify CLI command` seed (doubles as location
health check).

## Testing

- Adapter contract test suite, run against every adapter implementation.
- Missing-file fixture: manifestation whose path doesn't resolve → `unavailable`
  in stat, search result marker, `verify` output.
- Unplugged-volume simulation: rename a fixture directory mid-test; assert graceful
  degradation and `last_seen_at` retained.
- URI round-trip: absolute paths with spaces/unicode survive `file://`
  normalization and back.

## Open questions

1. URI normalization details for existing absolute paths (percent-encoding,
   `/Volumes` case sensitivity) — worth a tiny spike before the migration.
2. Does availability checking run inline in search (cost per result) or only via
   `verify` / background jobs, with search reading the cached status?
3. Is phase 2 (HTTPS re-fetch) actually wanted, or does the retrieval orchestrator
   already cover re-download well enough that the adapter adds nothing? (Parking
   phases 2–3 at review leans toward the latter until proven otherwise.)

## Relationship to other plans

- [domain-model.md](domain-model.md) — provides manifestations (phase A) and the
  URI migration slot (phase C).
- [http-api.md](http-api.md) — consumes the link union for
  `/citations/{doi}/links`; enforces the no-raw-paths-to-remote-clients rule.
- [zotero-integration.md](zotero-integration.md) — attachment linking produces
  `file://` locations this plan then health-checks.
- [indexing-jobs.md](indexing-jobs.md) — availability refresh is a natural
  background job kind.
- [fts5-full-text-search.md](fts5-full-text-search.md) — unaffected; chunks persist
  even when the source file is offline (never silently deleted).
