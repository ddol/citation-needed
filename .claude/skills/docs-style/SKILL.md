---
name: docs-style
description: >-
  Enforce the citation-needed documentation house style when writing or editing
  any Markdown doc (README.md, DESIGN.md, TENETS.md, BACKLOG.md, docs/,
  docs/plans/). Rules: sentence-case headers, no dates in prose (git history is
  the record), terse declarative present-tense tone, no em-dashes, concise. Use
  before committing any doc change and when running a documentation consistency
  pass.
---

# Documentation house style

These docs are read by engineers and by agents grounding on the corpus. The
voice is terse, declarative, and present-tense: state the rule, then the reason.
This skill is the checklist for writing a new doc or reviewing an existing one.
The skill file itself obeys every rule below, so read it as a worked example.

## Headers

Sentence case for every heading, H1 through H4: capitalize the first word and
nothing else except proper nouns, acronyms, and code identifiers.

- Yes: `## Current state`, `## Retrieval and access`, `### Operation mapping table`
- No: `## Current State`, `## Retrieval And Access`, `### Operation Mapping Table`

Capitalize these as written wherever they appear in a heading: SQLite, MCP,
BibTeX, DOI, arXiv, FTS5, PDF, Markdown, CLI, HTTP, API, JSON, RIS, CSV, OCR,
LaTeX, SSO, Unpaywall, Semantic Scholar, Crossref, Zotero, OpenAlex, PubMed,
Nougat, BLIP, and any code identifier (`DoiResolver`, `ImportService`,
`read-content`). Everything else in a heading is lowercase unless it starts the
line.

Do not number headings for ordering unless the numbers are part of the content
(a tenet list, a phased plan). One H1 per document.

## No dates

Git history is the record of when a doc changed or was reviewed. Do not write
dates into prose or metadata.

- Remove `Last reviewed | <date>` rows and any `As of <date>` or changelog-style
  date lines. `git log -- <file>` answers when.
- Do not date design decisions in the body. Describe the decision and its
  reason; the commit carries the date.
- Real-world dates that are part of the subject matter are fine: a paper's
  publication year in a citation, an API's documented rate-limit window, a
  version string. The ban is on dating the document about itself.

## No em-dashes

Do not use the em-dash (`—`). Pick the punctuation that fits the join:

| Em-dash use             | Replace with     | Example rewrite                                                                     |
| ----------------------- | ---------------- | ----------------------------------------------------------------------------------- |
| Introduces an expansion | colon            | `one workflow — grounded answers` to `one workflow: grounded answers`               |
| Parenthetical aside     | commas or parens | `the cascade — cache first — runs` to `the cascade (cache first) runs`              |
| Joins two full clauses  | period or `and`  | `it returns something — we still verify` to `it returns something. We still verify` |
| Trailing afterthought   | period           | `refuse the match — always` to `refuse the match. Always`                           |

Keep the en-dash (`–`) in numeric and span ranges: `3–5`, `1–2 h`, `K=1`,
`half–full day`. Those are correct typography and are not em-dashes. Hyphens in
compound modifiers (`title-based`, `off-by-default`) stay as they are.

## Tone

- Present tense, active voice, declarative. `The cascade resolves`, not `The
cascade will try to resolve`.
- Lead a rule or section with the claim in bold, then the reason. `**DOI-keyed
sources run before title search.** A DOI names exactly one paper.`
- State the reason before or right after the mechanism, never leave a rule
  unexplained. The tenet is why; the rule is the shape.
- Emphasis is `*italic*` for a single load-bearing word and `**bold**` for a
  lead-in claim. Do not shout in all-caps.
- Address the reader as a peer. No marketing adjectives (`powerful`,
  `seamless`, `robust`), no hedging (`simply`, `just`, `basically`).

## Concise

- Cut filler: `in order to` to `to`, `is able to` to `can`, `due to the fact
that` to `because`, `a number of` to a count.
- One idea per sentence. Break a sentence that needs an em-dash to survive.
- Delete a sentence that restates the previous one. Delete a section that
  duplicates another doc; link to it instead.
- Prefer a table or list when comparing more than two things; prefer a sentence
  otherwise.
- Wrap prose at roughly 80 columns to match the existing docs. Let Prettier
  settle list and table formatting.

## Review pass

Run these before committing a doc change:

1. `grep -n '—' <file>` returns nothing.
2. Every heading is sentence case, proper nouns aside.
3. No `Last reviewed` row and no self-referential dates.
4. `npx prettier --check <file>` passes.
5. Read each paragraph once: if a sentence can lose a word without losing
   meaning, cut the word.
