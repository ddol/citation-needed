# Zotero Integration

| Field         | Value                                                                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status        | **Exploratory** (2026-07-12 scope cut — design parked; Better BibTeX auto-export already covers Zotero→corpus with zero code)                                           |
| Milestone(s)  | M3 (import), M5 (integration)                                                                                                                                           |
| Work-stream   | D — Researcher Workflow                                                                                                                                                 |
| Depends on    | [domain-model.md](domain-model.md) phase B (identifiers) for phase 2; [storage-adapters.md](storage-adapters.md) soft (attachment linking works with plain paths first) |
| Absorbs       | Source exploration §12, §13, Phases 5 + 8; decision questions 9, 12                                                                                                     |
| Last reviewed | 2026-07-12                                                                                                                                                              |

## Intent

Zotero is the bibliography manager; citation-needed is the search/indexing layer.
Integration means importing Zotero's metadata and attachment locations, and linking
back via `zotero://` URLs — **not** replacing Zotero's UI, reader, or citation
tooling, and **not** bidirectional sync. The repo is BibTeX-first, which makes one
integration path free today.

## Current state

- Import is BibTeX-only (`bibtex-parse`; `parseBibtex` in `src/parsers/bibtex.ts`),
  keyed by DOI: `addCitation` is `INSERT OR IGNORE` on `doi`
  (`src/db/index.ts:209`) — re-importing an existing DOI is a **no-op, never an
  update**. Both import paths hard-skip DOI-less entries.
- M3 already contains the seed `[parse] M - Zotero JSON export format import`.
- No Zotero code, identifiers table, or attachment linking exists anywhere.
- Note for phase 2: Zotero stores attachments under
  `~/Zotero/storage/<ITEMKEY>/…` (or linked files at arbitrary paths).

## Design

### Integration paths, weighted for a BibTeX-first repo

| Path                                        | Cost          | Freshness     | Coupling                                   | Verdict              |
| ------------------------------------------- | ------------- | ------------- | ------------------------------------------ | -------------------- |
| Better BibTeX auto-export → existing import | **zero code** | on-save       | none                                       | document now         |
| Zotero/CSL JSON export file import          | M             | manual export | none                                       | build (phase 1)      |
| Zotero 7 local HTTP API (`localhost:23119`) | L             | incremental   | Zotero must run; verify endpoint stability | phase 3 (deferred)   |
| Zotero Web API                              | M–L           | cloud sync    | network, API keys, sync state              | rejected for v1      |
| Reading `zotero.sqlite` directly            | —             | —             | fragile, unsupported                       | rejected permanently |

**Better BibTeX** with pinned citation keys already produces a `.bib` the existing
importer consumes — a zero-code path that only needs documentation (including the
`file` field for attachment paths).

**Zotero JSON import** (the enriched M3 seed): parse metadata **plus** item key,
library ID, tags, collections, and attachment paths into the parsed-entry model,
even though phase 1 stores only what the schema supports today. Capturing at parse
time means phase 2 is a storage change, not a parser change.

### Phase 2 (M5): identifiers, attachments, tags, links

- Store `zotero-key` + `zotero-library` in the `identifiers` table
  ([domain-model.md](domain-model.md) phase B).
- **Link Zotero attachment PDFs as manifestations instead of re-downloading** —
  the concrete user win: no duplicate PDFs, instant "has PDF" for papers Zotero
  already has. **Linked-file attachments (decided at review): record +
  health-check** — trust the recorded path outside Zotero storage, create the
  manifestation, and let availability tracking
  ([storage-adapters.md](storage-adapters.md) phase 1) mark it unavailable if
  missing, consistent with how everything else degrades.
- **Tags and collections (decided at review): proper join tables at M5** — `tags`
  - `citation_tags` + `collections` (with nesting) populated from Zotero import,
    giving SearchService and the future `/collections` `/tags` endpoints clean SQL
    filters.
- Emit `zotero://select/library/items/<KEY>` links in search/MCP/API results when
  the item key is known — the cheapest frontend integration (source Option C).
  Supported URL forms (including group libraries and `open-pdf?page=`) must be
  verified against current Zotero before results rely on them.

### Enrichment on re-import (decided at review)

Default semantics stay `INSERT OR IGNORE` — imports never touch existing rows. An
**opt-in `--update` mode** adds enrichment: fill null fields always, overwrite
only non-protected fields (Crossref-verified metadata is protected), and report
every change in the import summary. Conflicts are surfaced, never silently
resolved.

### Frontends

External web UI (Option A) and a thin Zotero plugin (Option B) are **deferred until
the HTTP API stabilizes** ([http-api.md](http-api.md)); both would be pure API
clients. `zotero://` links (Option C) ship first as above.

### Rejected / deferred alternatives

- **Automatic bidirectional sync**: rejected (source doc agrees); explicit future
  actions (add tag, add note) only, with namespacing, if ever.
- **Zotero Web API for v1**: network + key management for a local tool.
- **Reading/writing `zotero.sqlite`**: permanently rejected.
- **JSON column for tags/collections**: rejected at review in favor of join
  tables at M5.
- **Skipping unresolvable linked files at import**: rejected at review in favor
  of record + health-check.

## Phasing

1. **M3**: enriched Zotero JSON import (metadata now; key/tags/collections/paths
   captured) + `--update` enrichment mode + Better BibTeX workflow documentation.
2. **M5**: identifiers rows; attachment-PDF manifestation linking; tags/collections
   join tables; `zotero://` links in results.
3. **Deferred**: local-API incremental pull (as enqueue-jobs, see
   [indexing-jobs.md](indexing-jobs.md)); plugin/web UI after the API stabilizes.

## Proposed backlog items

Milestone 3 (adopted 2026-07-12):

- [parse] M - Zotero JSON export import: metadata + capture item key, library id, tags, collections, attachment paths (see docs/plans/zotero-integration.md)
- [parse] S - Opt-in --update import mode: gap-fill null fields, overwrite only non-protected fields, report changes (see docs/plans/zotero-integration.md)
- [docs] S - Document Better BibTeX auto-export (pinned keys, file field) as the zero-code Zotero → citation-needed path (see docs/plans/zotero-integration.md)

Milestone 5 (adopted 2026-07-12):

- [db] S - Store Zotero item key + library id in identifiers table on import
- [db] M - tags + collections join tables populated from Zotero import; SearchService and API filters (see docs/plans/zotero-integration.md)
- [flow] M - Link Zotero storage and linked-file attachment PDFs as manifestations instead of re-downloading (see docs/plans/zotero-integration.md)
- [search] S - Emit zotero://select links in search/MCP/API results when item key known (verify supported URL forms first)
- [flow] L - Zotero 7 local HTTP API import (localhost:23119) with incremental pull

**Rewrites in place**: the existing M3 `[parse] M - Zotero JSON export format
import` seed (enriched wording above).

## Testing

- Fixture Zotero JSON export containing: item with stored attachment, item with
  linked-file attachment, DOI-less item (skipped + reported until domain-model M5
  admission lands), nested collections, group-library item.
- Import idempotency: second import is a no-op with a clean summary.
- `--update` semantics: null fields filled; protected fields untouched with a
  conflict report; non-protected fields overwritten and reported.
- Identifier collision: same `zotero-key` appearing for two DOIs → hard error.
- Attachment linking: manifestation row points at the Zotero storage path; no
  download attempted when the file exists; missing linked file → manifestation
  created, marked unavailable by health check.
- Tags/collections round-trip: import → filterable via SearchService.

## Open questions

None remaining. Resolved at the 2026-07-12 review:

1. Enrichment → **opt-in `--update`**: gap-fill always, overwrite only
   non-protected fields, all changes reported.
2. Tags/collections storage → **join tables at M5** (backlog item added).
3. DOI-less Zotero items → resolved via [domain-model.md](domain-model.md):
   admission **committed at M5** (guards relax; identifiers + internal ID).
4. Linked-file attachments → **record + health-check** via availability tracking.

## Relationship to other plans

- [domain-model.md](domain-model.md) — phase 2 needs identifiers (phase B);
  attachment linking writes manifestations (phase A); DOI-less admission lands
  there.
- [storage-adapters.md](storage-adapters.md) — Zotero storage paths become
  `file://` locations; availability checks cover linked files; a dedicated zotero
  adapter is not needed.
- [http-api.md](http-api.md) — future plugin/web UI consume the API;
  `/collections` and `/tags` endpoints unblock once the join tables exist.
- [indexing-jobs.md](indexing-jobs.md) — local-API incremental import enqueues jobs.
- [service-layer.md](service-layer.md) — the importer should reuse ImportService
  once its phase 2 lands.
- [citation-graph.md](citation-graph.md) — complementary (augment decision,
  2026-07-12): the graph is the discovery/acquisition channel; Zotero remains
  the curated-library workflow sync.
