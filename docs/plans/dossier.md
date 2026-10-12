# Source dossiers

| Field      | Value                                                                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status     | **Core: slices 5–8** (slice 4 builds its prerequisites)                                                                                                                                                                             |
| Flow       | Dossier                                                                                                                                                                                                                             |
| Depends on | [model-providers.md](model-providers.md), [indexing-jobs.md](indexing-jobs.md), [visual-extraction.md](visual-extraction.md), [web-ui.md](web-ui.md); reuses the shipped retrieval, extraction, chunking, and `verify-quote` layers |

## Intent

Hand citation-needed one source and get back a **dossier**: a faithful,
complete digest a researcher can read in place of a first pass through the
source and trust as a map of it. The dossier states what the source claims and
how it argues, reproduces its mathematics in LaTeX, describes its diagrams,
reproduces its tables, and says nothing the source does not say. Every dossier
ends with a standardized provenance footer naming the models that wrote it,
when the source was extracted, and when the dossier was synthesized.

Comprehension needs language models: no deterministic pass reads a proof or
describes a plot. Faithfulness needs the opposite. The shipped deterministic
layer (retrieval with identity checks, extraction, chunking, `verify-quote`)
becomes the evidence every generated line is checked against.

## Current state

- The evidence layer exists: the retrieval cascade with identity checks, pdf2md
  plus `pdftotext -layout` extraction with heading, table, and equation repair,
  the heading chunker, FTS5, and `verify-quote` with section provenance.
- The hard regions are already located deterministically:
  `extractLayoutEquations` finds labelled display equations, `markdown.ts` maps
  figure captions and equations to pages (`figureCaptionsForLayout`,
  `equationPagesForLayout`), and `layout-tables.ts` aligns most tables.
- `score-markdown-quality` already counts sections, tables, and equations per
  paper, which is most of the source profile.
- No model calls, no key storage, no job queue, no HTTP server.

## Anatomy

A dossier has a fixed anatomy, rendered from a template, so every dossier reads
the same way. A part with nothing to report is omitted, not padded.

| Part                 | Content                                                                                                                        | Written by             | Checked by                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ----------------------------------------------- |
| Identity             | title, authors, year, venue, DOI or arXiv id                                                                                   | database metadata      | not generated                                   |
| Synopsis             | problem, approach, findings, in the authors' framing                                                                           | writer                 | quote and number gates, auditor                 |
| Claims               | each contribution the authors claim, with a verbatim supporting quote and its section path                                     | reader, then writer    | quote gate, auditor                             |
| Section digests      | one entry per source section, in source order                                                                                  | reader                 | number and coverage gates, auditor              |
| Mathematics          | every display equation in LaTeX with source numbering; symbols as the source defines them; the equation's role in the argument | math, reader           | LaTeX, layout cross-check, second transcription |
| Figures and diagrams | caption verbatim; what is drawn (kind, axes, components, flows, legend); what the text says the figure shows                   | figure                 | caption, number gate, auditor                   |
| Tables               | Markdown tables, values verbatim                                                                                               | extractor, figure      | number gate                                     |
| Stated limitations   | limitations and future work in the authors' words                                                                              | reader                 | quote gate                                      |
| Glossary             | terms and symbols as the source defines them                                                                                   | reader                 | quote gate on each definition                   |
| Provenance footer    | see [Provenance footer](#provenance-footer)                                                                                    | renderer, from records | never model-written                             |

## Objectivity

**The dossier reports; it does not review.** Prompts state these rules, the
gates enforce what is mechanical, and the auditor flags the rest:

- **Attribute every claim.** "The authors report…", never the dossier asserting
  a result in its own voice.
- **No evaluation.** No "novel", "significant", "state-of-the-art", or
  "elegant" outside a verbatim quote.
- **No outside knowledge.** The dossier contains what the source says. A
  glossary entry defines a term only as the source defines it.
- **Reproduce the exact things.** Numbers, equations, captions, quotations,
  and table values are copied, never paraphrased or recomputed. A derived
  number the source never states ("a 12% improvement") fails the number gate.
- **Ambiguity stays visible.** Where the source is unclear or contradicts
  itself, the dossier says so and points at both passages.

## Size follows the source

**Length is a consequence of coverage, never a target.** A deterministic
**source profile**, computed before any model runs, sets the dossier's shape:

| Metric                         | From                                           |
| ------------------------------ | ---------------------------------------------- |
| pages, words                   | PDF, extracted Markdown                        |
| sections and their word counts | heading trail (the chunker's `sectionPath`)    |
| display equations with page    | `extractLayoutEquations`, Markdown `$$` blocks |
| figures with caption and page  | layout captions                                |
| tables                         | Markdown tables, `layout-tables.ts`            |
| extraction quality per section | `score-markdown-quality` metrics               |

Every section, display equation, figure, and table gets an entry. Prose
budgets scale with what they digest: a section digest runs about a tenth of the
section's length, floored at 40 words and capped at 400. The synopsis and the
structure follow a tier set from page and word counts:

| Tier      | Typical source                       | Synopsis                         | Structure             |
| --------- | ------------------------------------ | -------------------------------- | --------------------- |
| Brief     | under 6 pages: letters, short papers | ~100 words                       | flat                  |
| Standard  | 6–30 pages: most papers              | ~250 words                       | flat                  |
| Extended  | 30–100 pages: long papers, reports   | ~400 words                       | flat, grouped by part |
| Long-form | over 100 pages: theses, books        | ~400 words, plus one per chapter | chapter, then section |

Complexity changes length through entries, not through the tier: an
equation-dense 10-page paper produces a longer dossier than a 10-page essay
because each equation gets its own entry. Budget constants are starting values,
tuned by the eval. The tier and profile are stored with the dossier and
summarized in the footer.

## Pipeline

One dossier job per source. Stages run in order; each records its outputs keyed
by input hash, so a resumed or re-run job skips work already done.

```
acquire    DOI or arXiv id via the retrieval cascade, or a PDF    deterministic
extract    pdf2md + layout repair (shipped)                       deterministic
profile    metrics, region list, tier, budgets; index chunks      deterministic
disclose   access check before any remote model sees the source   deterministic
rasterize  equation, figure, and table regions to PNG             deterministic
math       LaTeX per display equation, two transcriptions         math, auditor roles
figures    description per figure; unaligned tables               figure role
read       digest per section, with its equations and figures     reader role
compose    dossier from template, digests, and budgets            writer role
check      gates; auditor findings; one revision pass             deterministic, auditor role
render     footer from records; write files; manifestations       deterministic
```

`math`, `figures`, and `read` fan out per item with bounded concurrency per
provider; `compose` reduces. Long-form sources reduce twice (section to chapter
to dossier). Each call sees only the slice of the source it needs plus the
shared profile, which keeps every call inside its context window and makes each
output attributable to a section.

Models read extracted Markdown by default: cheap, structured, and already
indexed for the quote gate. A section whose extraction scores below the quality
threshold is sent as page images instead, so a bad extraction degrades cost,
not fidelity. Equations, figures, and unaligned tables always go as images
(see [visual-extraction.md](visual-extraction.md)).

## Source access and disclosure

**A remote model sees a source only when its access allows it, or when the
user confirms it for that dossier.** Publisher licences on paywalled papers
often forbid uploading their content to AI services. Open-access copies usually
permit it, and a local model sends nothing anywhere.

| Source access (`citations.access_type`)            | Remote roles                  | Local roles |
| -------------------------------------------------- | ----------------------------- | ----------- |
| `open-access` (Unpaywall, Semantic Scholar, arXiv) | run                           | run         |
| `institutional` (downloaded through a proxy)       | need per-dossier confirmation | run         |
| `unknown` (a file already on disk, an upload)      | need per-dossier confirmation | run         |

- The `disclose` stage runs after `profile` and before the first model call. A
  restricted source with any remote role pauses the job, and the UI offers two
  ways on: confirm remote providers for this dossier, or switch every role to a
  local model.
- Confirmation is per dossier. There is no global override, because licence
  terms differ by publisher and by agreement.
- The confirmation (when, and which roles and providers it covered) is stored on
  the dossier and printed in the footer.
- The licence a resolver reports (Unpaywall's `best_oa_location.license`,
  Semantic Scholar's where it reports one) is stored on the PDF manifestation,
  because a licence belongs to the copy downloaded, and printed in the footer.

## Model roles

Code asks for a role, never a model. Roles are assigned to models in the web UI
(see [model-providers.md](model-providers.md)).

| Role    | Job                                                                                     | Needs                      |
| ------- | --------------------------------------------------------------------------------------- | -------------------------- |
| reader  | digest a section; extract claims, limitations, symbol definitions, glossary             | long context, faithful     |
| math    | transcribe an equation region to LaTeX                                                  | vision                     |
| figure  | describe a figure region; transcribe a table image                                      | vision                     |
| writer  | compose the dossier from parts under the template; revise flagged lines once            | instruction following      |
| auditor | second LaTeX transcription of every equation; audit the composed dossier against source | vision, a different family |

**Independence is the point of the auditor.** Two models from one family share
blind spots, so agreement between them is weak evidence. The auditor must come
from a different family than the reader and writer; when it cannot (an
all-local setup with one family installed), the dossier still runs and the
footer says the audit was not independent.

## Checks

**Every generated item is checked or marked.** Deterministic gates run on every
dossier. A failure stays in place, marked ⚑ with its reason, and counts in the
footer. Nothing is silently dropped or rewritten.

| Gate               | Rule                                                             | Mechanism                                                                                                                       |
| ------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Quote              | every quotation attributed to the source is found in it          | `verify-quote` (exact, or close match at ≥ 0.8 token overlap) against the source's own chunks                                   |
| Number             | every number in prose and tables appears in the source text      | normalized numeric tokens (`0.5`/`.5`, thousands separators, `%`, scientific notation); equation, section, figure labels exempt |
| LaTeX              | every equation parses                                            | KaTeX `renderToString` with `throwOnError`                                                                                      |
| Equation agreement | two independent transcriptions agree                             | LaTeX compared after removing presentation-only commands (spacing, `\left`/`\right`, redundant braces)                          |
| Layout cross-check | a transcription's symbols match the source line                  | symbol multiset overlap between the KaTeX-tokenized LaTeX and the `normalizeMathGlyphs` layout line                             |
| Caption            | a figure caption is verbatim                                     | captions are injected from the layout text, never generated                                                                     |
| Coverage           | every profiled section, equation, figure, and table has an entry | profile against dossier parts                                                                                                   |

Then the **auditor** reads the composed dossier against the source, section by
section, and returns structured findings (`unsupported`, `evaluative`,
`misattributed`, `omission`), each with the dossier line and the source
evidence. Findings mark lines ⚑. The writer gets **one** revision pass over
flagged lines, and whatever still fails stays marked. One pass, never a loop:
the same rule the retrieval breaker follows.

A dossier is `complete` when every stage ran. Complete with flags is a normal
outcome, shown in the UI and the footer. A source whose identity is uncertain
never starts: acquisition refuses and says why, exactly as import does.

## Provenance footer

**Rendered by code from records, never written by a model.** The renderer reads
`model_runs`, `manifestations`, `retrieval_log`, and the dossier's check
results. Same fields, same order, same fixed preamble, every dossier:

```markdown
---

## Provenance

This dossier was compiled by language models from the source identified below.
Quotations, numbers, equations, and coverage were checked against the source by
deterministic tests; lines marked ⚑ failed a check and are left in place for
review. Equation transcriptions and figure descriptions are model output.

| Field       | Value                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Source      | Liang et al. (2020). Learning lane graph representations for motion forecasting. arXiv 2007.13732v1                                       |
| Source file | sha256 3f2a9c…e81d · 18 pages · retrieved 2026-10-12 14:01 UTC via arXiv                                                                  |
| Access      | open access via arXiv · licence not reported                                                                                              |
| Extracted   | 2026-10-12 14:03 UTC · @opendocsg/pdf2md 0.2.6 · pdftotext 24.02                                                                          |
| Synthesized | 2026-10-12 14:21 UTC · pipeline 1.0.0 · prompt set 3c9e1a                                                                                 |
| Size        | Standard tier · 9 sections · 14 equations · 6 figures · 4 tables                                                                          |
| Models      | reader anthropic/claude-sonnet-5-5 · math openrouter/… · figure ollama/… · writer anthropic/claude-opus-5-5 · auditor openrouter/…        |
| Checks      | quotes 41/41 · numbers 112/115 (3 ⚑) · equations 14/14 parse, 12/14 agree (2 ⚑) · captions 6/6 · coverage 33/33 · auditor 2 findings, 1 ⚑ |
| Usage       | 412k input, 38k output tokens · $1.84 as reported by providers                                                                            |
```

Model names are the ones each provider's response reported, not the aliases
requested. "Access" carries the licence when one was reported, and for a
restricted source, when the user confirmed remote providers and for which
roles. "Extracted" is when the deterministic extraction ran; "Synthesized" is
when rendering finished. Both are UTC timestamps from the records. The
footer layout carries a version so parsers can rely on it.

## Storage

- **`dossiers`**: one row per dossier: citation, status, tier, profile (JSON),
  pipeline version, prompt-set hash, disclosure confirmation (timestamp, roles,
  providers), created and finished timestamps.
- **`dossier_parts`**: one row per item: kind (`synopsis`, `claim`, `section`,
  `equation`, `figure`, `table`, `limitation`, `glossary`), key (section path,
  equation label, figure number), ordinal, content, status (`ok`, `flagged`,
  `failed`), flags, the `model_runs` row that produced it, and its input hash.
  Resume and per-item UI status read from here.
- **`model_runs`**: owned by [model-providers.md](model-providers.md).
- **Files**: `<stem>.dossier.json` is the source of truth; `<stem>.dossier.md`
  is rendered from it, and so is the web view. Both are manifestations (kinds
  `dossier-json` and `dossier`, added to the `kind` CHECK by migration) next to
  the extracted Markdown.

`verify-quote` stays scoped to extracted source text. A dossier quoting another
dossier would launder model output into evidence.

## Surfaces

The web UI is the first surface ([web-ui.md](web-ui.md)): add a source, watch
its stages, read the result, manage keys and role assignments. `DossierService`
(create, get, list, cancel, resume, retry) is the one definition; the HTTP
routes are its gateway. MCP tools (`create-dossier`, `read-dossier`) and a
`dossier` CLI command are adapters over the same service, exploratory until the
web flow proves out.

## Evaluation

Dossier quality is measured, not judged by eye. A gold set of sources with
human-verified claim lists, equation transcriptions, and figure facts, seeded
from the [claim-grounding-eval.md](claim-grounding-eval.md) pilot corpus with
Liang2020 as the documented worst case, scores claim recall, equation exact
match after normalization, figure-fact recall, and objectivity violations per
role assignment. Model choices come from those numbers. The harness lives in
`eval/`, outside Jest and the coverage ratchet.

## Phasing

Slices are vertical: each ends with something visible in the web UI.

1. **Slice 4, keys and models**: `serve`, the settings page, the secrets store,
   both provider adapters, role assignment, connection tests, `model_runs`.
   ([model-providers.md](model-providers.md), [web-ui.md](web-ui.md),
   [http-api.md](http-api.md))
2. **Slice 5, first dossier**: jobs and stages; acquire, extract, profile;
   disclosure check and licence capture; read and compose (text only); quote,
   number, and coverage gates; the footer; a per-dossier token cap; the progress
   page and dossier view.
3. **Slice 6, math and diagrams**: rasterizer, math stage with LaTeX gates and
   second transcription, figures, table fallback, KaTeX in the view.
   ([visual-extraction.md](visual-extraction.md))
4. **Slice 7, independent audit**: auditor findings, one revision pass,
   independence warning, cost estimate before start, dossier eval harness.
5. **Slice 8, any source**: PDF upload with DOI-less admission, long-form
   hierarchical reduce, per-section page-image fallback.

## Rejected alternatives

- **One model, one prompt, whole paper in context.** Cheapest to build, but no
  independence, no per-section attribution, no ceiling on length, and a
  hallucinated equation goes unnoticed.
- **A model-written footer.** Provenance a model writes is a claim, not a
  record.
- **Length targets ("summarize in N words").** A target pads short sources and
  drops equations from long ones; coverage-driven size does neither.
- **An auditor that edits.** An auditor that rewrites becomes a second writer
  with no checker. It flags; the writer revises once.
- **LLM-as-judge as the only check.** Judges share failure modes with writers.
  Deterministic gates catch what they can; the auditor covers the rest.
- **Splicing generated content into the extracted Markdown.** It would make the
  evidence layer nondeterministic. Generated content lives in dossier parts.
- **A background box drawing on model knowledge.** Helpful for terms the source
  assumes, but it is exactly the unchecked, unattributed content the dossier
  exists to exclude. The glossary defines terms only as the source does.
- **A global "always send to remote providers" switch.** Licence terms differ
  by publisher; consent is per dossier.

## Open questions

1. Non-PDF sources (HTML articles, EPUB, slides)? Later: the profile and region
   model assume PDF pages.
2. Index dossiers into FTS for corpus-wide search? Not in Core; `verify-quote`
   stays source-only either way.

## Relationship to other plans

- [model-providers.md](model-providers.md): providers, roles, keys,
  `model_runs`, spend limits.
- [visual-extraction.md](visual-extraction.md): region location,
  rasterization, the math and figure stages and their gates.
- [indexing-jobs.md](indexing-jobs.md): the job table, worker, and stage
  resume the pipeline runs on.
- [web-ui.md](web-ui.md) and [http-api.md](http-api.md): the surface and its
  server conventions.
- [fts5-full-text-search.md](fts5-full-text-search.md): `verify-quote` is the
  quote gate.
- [retrieval-pipeline.md](retrieval-pipeline.md): the acquire stage.
- [domain-model.md](domain-model.md): new manifestation kinds; DOI-less
  admission for uploads.
- [claim-grounding-eval.md](claim-grounding-eval.md): corpus and gold claims
  for the dossier eval.
