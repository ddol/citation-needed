# Local bibliography spider

| Field      | Value                                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Status     | **Exploratory** - local-first Flow C metadata spidering before external graph expansion                                                |
| Flow       | C                                                                                                                                      |
| Depends on | [domain-model.md](domain-model.md), [fts5-full-text-search.md](fts5-full-text-search.md), later [citation-graph.md](citation-graph.md) |

## Intent

Build local-first Flow C discovery from bibliographies of papers already in the
corpus. The spider should expand knowledge about missing or ambiguous cited
works using metadata only: extracted references become local graph evidence and
frontier citation records, but the workflow must not download PDFs or treat fuzzy
matches as verified.

This is the bridge between a researcher's held papers and claims from papers not
yet held. It should make the corpus able to say "this paper appears to cite
something we do not hold yet" and "this reference probably matches one of your
local papers, but needs review" before relying on external graph sources.

## Current State

- There is no local bibliography parser.
- Extracted Markdown is not scanned for reference sections.
- Raw reference mentions are not stored as first-class evidence.
- There is no local alignment review surface for ambiguous paper matches.
- Citation graph work is planned, but local extracted bibliography evidence is
  not yet modeled.

## Design

The workflow is intentionally metadata-only and local-first.

1. Scan extracted Markdown only. Use existing extracted content and skip papers
   without Markdown.
2. Detect reference sections using conservative heading and tail-section
   heuristics.
3. Split bibliography entries into raw reference strings while preserving the
   source DOI, section, ordinal, and raw evidence text.
4. Parse DOI, title, authors, year, venue, and pages when present.
5. Enrich missing DOI or insufficient metadata through Crossref by default.
   `--no-crossref` disables this network enrichment path.
6. Create metadata-only frontier citations for references that are not present
   locally and have enough identity to track.
7. Store raw reference evidence even when parsing or enrichment fails.
8. Exact DOI matches create extracted citation edges between local corpus
   members.
9. Fuzzy local matches become review candidates, not citation edges.
10. Conflicts, low-confidence matches, and unresolved references remain visible
    as alignment issues.

### Storage Shape

- `reference_mentions`: one row per extracted bibliography entry, including
  source citation, raw reference text, parser output, enrichment provenance, and
  status.
- `reference_match_candidates`: one row per possible local match, including
  score, matching reasons, review status, reviewer decision, and timestamps.
- Existing or planned citation/citation-edge tables should receive only verified
  identities: exact DOI matches or accepted review candidates.

### Alignment Rules

- Exact DOI match: link to the existing local citation and emit an extracted
  citation edge.
- DOI not held: create or update a metadata-only frontier citation.
- DOI absent but metadata strong: create an unmatched frontier citation when
  confidence is high enough to avoid duplicate churn.
- Fuzzy local match: create review candidates and keep the mention unresolved
  until accepted.
- Multiple plausible matches: mark the mention as conflict and avoid edge
  creation.

## Interfaces

CLI:

```sh
citation-needed spider-references [--doi <doi>] [--limit <n>] [--no-crossref]
citation-needed reference-issues [--doi <doi>] [--status candidate|unmatched|conflict]
citation-needed reference-review accept <candidate-id>
citation-needed reference-review reject <candidate-id>
```

MCP:

- `spider-references`
- `get-reference-issues`
- `verify-reference-match`

`check-corpus` should report ambiguous local bibliography matches once this work
lands, so a caller can distinguish `absent` from "present only as an unresolved
local candidate."

## Testing

- Parser fixtures for common bibliography formats, numbered references,
  hanging-indented entries, DOI-only entries, and noisy extracted Markdown.
- Crossref recorded fixtures for DOI enrichment, title/year enrichment, no
  result, and conflicting result behavior.
- Exact DOI linking from a parsed reference to a held paper.
- Fuzzy candidate creation when a parsed reference likely matches a held paper
  but lacks a DOI.
- Conflict behavior when multiple local papers plausibly match.
- Unmatched frontier creation for missing papers with enough metadata.
- Review accept/reject behavior, including idempotency and edge creation only
  after acceptance.
- Metadata-only no-download assertion for the full spider workflow.

## Backlog Items

- [verify] M - Local bibliography parser: detect reference sections in extracted Markdown and parse raw reference entries into structured metadata (see docs/plans/local-bibliography-spider.md)
- [db] M - reference_mentions + reference_match_candidates tables for extracted bibliography evidence and local alignment review (see docs/plans/local-bibliography-spider.md)
- [fetch] M - Crossref enrichment for parsed references missing DOI or enough metadata, fixture-tested and disabled with --no-crossref (see docs/plans/local-bibliography-spider.md)
- [flow] M - spider-references metadata-only workflow: scan member papers, create frontier citations, and store alignment issues without downloading PDFs (see docs/plans/local-bibliography-spider.md)
- [cli] M - reference-issues and reference-review commands for accepting/rejecting fuzzy local match candidates (see docs/plans/local-bibliography-spider.md)
- [mcp] M - MCP tools: spider-references, get-reference-issues, verify-reference-match; check-corpus reports ambiguous matches (see docs/plans/local-bibliography-spider.md)
- [test] M - Bibliography spider fixtures: reference splitting, Crossref enrichment, exact DOI linking, fuzzy candidate review, frontier creation (see docs/plans/local-bibliography-spider.md)

## Assumptions

- This is documentation and backlog scheduling only; implementation should not
  change code until the work is explicitly scheduled.
- Completed backlog items stay untouched.
- Local bibliography spidering runs before external graph-source expansion in
  Flow C because it uses evidence already present in the corpus.

## Open questions

1. Crossref enrichment should share the same client/provenance model as the
   broader metadata enrichment item in
   [retrieval-pipeline.md](retrieval-pipeline.md); implementation should avoid
   a second ad hoc Crossref fetcher.
2. Accepted local reference matches should become citation-graph edges once
   [citation-graph.md](citation-graph.md) lands. Until then, they remain local
   reference evidence plus review decisions.

## Relationship to other plans

- [fts5-full-text-search.md](fts5-full-text-search.md) — provides extracted
  Markdown and quality/post-processing work that improves bibliography parsing.
- [domain-model.md](domain-model.md) — identifiers and DOI-less admission
  determine how weakly identified frontier references are represented.
- [citation-graph.md](citation-graph.md) — consumes exact DOI links and accepted
  review matches as extracted citation edges; does not duplicate the parser.
- [retrieval-pipeline.md](retrieval-pipeline.md) — owns the shared Crossref
  enrichment and retrieval-cascade boundary.
