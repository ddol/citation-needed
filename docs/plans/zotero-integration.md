# Zotero integration

| Field      | Value                                                                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status     | **Exploratory** — Better BibTeX auto-export already covers Zotero → corpus with zero code                                                                               |
| Flow       | A                                                                                                                                                                       |
| Depends on | [domain-model.md](domain-model.md) phase B (identifiers) for phase 2; [storage-adapters.md](storage-adapters.md) soft (attachment linking works with plain paths first) |

## Intent

Zotero is the bibliography manager; citation-needed is the search/indexing
layer. Integration means importing Zotero's metadata and attachment locations,
and linking back via `zotero://` URLs — **not** replacing Zotero's UI, reader,
or citation tooling, and **not** bidirectional sync. The repo is BibTeX-first,
which makes one integration path free today.

## Current state

- Import is BibTeX-only (`bibtex-parse`; `parseBibtex` in `src/parsers/bibtex.ts`),
  keyed by DOI: `addCitation` is `INSERT OR IGNORE` on `doi`
  (`src/db/index.ts:209`) — re-importing an existing DOI is a **no-op, never an
  update**. Both import paths hard-skip DOI-less entries.
- No Zotero code, identifiers table, or attachment linking exists anywhere.
- Zotero stores attachments under `~/Zotero/storage/<ITEMKEY>/…` (or linked
  files at arbitrary paths).

## Design

### Integration paths, weighted for a BibTeX-first repo

| Path                                        | Cost          | Freshness     | Coupling                                   | Verdict              |
| ------------------------------------------- | ------------- | ------------- | ------------------------------------------ | -------------------- |
| Better BibTeX auto-export → existing import | **zero code** | on-save       | none                                       | document (phase 1)   |
| Zotero/CSL JSON export file import          | M             | manual export | none                                       | build (phase 1)      |
| Zotero 7 local HTTP API (`localhost:23119`) | L             | incremental   | Zotero must run; verify endpoint stability | phase 3              |
| Zotero Web API                              | M–L           | cloud sync    | network, API keys, sync state              | rejected for v1      |
| Reading `zotero.sqlite` directly            | —             | —             | fragile, unsupported                       | rejected permanently |

**Better BibTeX** with pinned citation keys already produces a `.bib` the
existing importer consumes — a zero-code path that only needs documentation
(including the `file` field for attachment paths).

**Zotero JSON import**: parse metadata **plus** item key, library ID, tags,
collections, and attachment paths into the parsed-entry model, even though
phase 1 stores only what the schema supports. Capturing at parse time means
phase 2 is a storage change, not a parser change.

### Phase 2: identifiers, attachments, tags, links

- Store `zotero-key` + `zotero-library` in the `identifiers` table
  ([domain-model.md](domain-model.md) phase B).
- **Link Zotero attachment PDFs as manifestations instead of re-downloading** —
  the concrete user win: no duplicate PDFs, instant "has PDF" for papers Zotero
  already has. Linked-file attachments (outside Zotero storage): **record +
  health-check** — trust the recorded path, create the manifestation, and let
  availability tracking ([storage-adapters.md](storage-adapters.md)) mark it
  unavailable if missing.
- **Tags and collections as join tables** — `tags` + `citation_tags` +
  `collections` (with nesting) populated from Zotero import, giving
  SearchService and the future `/collections` `/tags` endpoints clean SQL
  filters.
- Emit `zotero://select/library/items/<KEY>` links in search/MCP/API results
  when the item key is known — the cheapest frontend integration. Supported URL
  forms (including group libraries and `open-pdf?page=`) must be verified
  against current Zotero before results rely on them.

### Enrichment on re-import

Default semantics stay `INSERT OR IGNORE` — imports never touch existing rows.
An **opt-in `--update` mode** adds enrichment: fill null fields always,
overwrite only non-protected fields (Crossref-verified metadata is protected),
and report every change in the import summary. Conflicts are surfaced, never
silently resolved.

### Frontends

External web UI and a thin Zotero plugin are **deferred until the HTTP API
exists** ([http-api.md](http-api.md)); both would be pure API clients.
`zotero://` links ship first as above.

### Rejected / deferred alternatives

- **Automatic bidirectional sync**: explicit future actions (add tag, add
  note) only, with namespacing, if ever.
- **Zotero Web API for v1**: network + key management for a local tool.
- **Reading/writing `zotero.sqlite`**: permanently rejected.
- **JSON column for tags/collections**: join tables instead (phase 2).
- **Skipping unresolvable linked files at import**: record + health-check
  instead.

## Phasing

1. Enriched Zotero JSON import (metadata now; key/tags/collections/paths
   captured) + `--update` enrichment mode + Better BibTeX workflow
   documentation.
2. Identifiers rows; attachment-PDF manifestation linking; tags/collections
   join tables; `zotero://` links in results.
3. Local-API incremental pull (as enqueued jobs, see
   [indexing-jobs.md](indexing-jobs.md)); plugin/web UI after the HTTP API
   exists.

## Backlog items (all exploratory)

Phase 1:

- [parse] M - Zotero JSON export import: metadata + capture item key, library id, tags, collections, attachment paths (see docs/plans/zotero-integration.md)
- [parse] S - Opt-in --update import mode: gap-fill null fields, overwrite only non-protected fields, report changes (see docs/plans/zotero-integration.md)
- [docs] S - Document Better BibTeX auto-export (pinned keys, file field) as the zero-code Zotero → citation-needed path (see docs/plans/zotero-integration.md)

Phase 2:

- [db] S - Store Zotero item key + library id in identifiers table on import
- [db] M - tags + collections join tables populated from Zotero import; SearchService and API filters (see docs/plans/zotero-integration.md)
- [flow] M - Link Zotero storage and linked-file attachment PDFs as manifestations instead of re-downloading (see docs/plans/zotero-integration.md)
- [search] S - Emit zotero://select links in search/MCP/API results when item key known (verify supported URL forms first)

Phase 3:

- [flow] L - Zotero 7 local HTTP API import (localhost:23119) with incremental pull

## Testing

- Fixture Zotero JSON export containing: item with stored attachment, item with
  linked-file attachment, DOI-less item (skipped + reported until DOI-less
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

None currently.

## Relationship to other plans

- [domain-model.md](domain-model.md) — phase 2 needs identifiers (phase B);
  attachment linking writes manifestations (phase A); DOI-less admission lands
  there.
- [storage-adapters.md](storage-adapters.md) — Zotero storage paths become
  `file://` locations; availability checks cover linked files; a dedicated
  zotero adapter is not needed.
- [http-api.md](http-api.md) — a future plugin/web UI consumes the API;
  `/collections` and `/tags` endpoints unblock once the join tables exist.
- [indexing-jobs.md](indexing-jobs.md) — local-API incremental import enqueues
  jobs.
- [service-layer.md](service-layer.md) — the importer should reuse
  ImportService once core slice 3 lands.
- [citation-graph.md](citation-graph.md) — complementary: the graph is the
  discovery/acquisition channel; Zotero remains the curated-library workflow
  sync.
