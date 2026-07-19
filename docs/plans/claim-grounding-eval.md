# Claim-grounding consumption eval: PDF vs Markdown vs MCP

**Status:** Proposed · **Flow:** B · **Depends on:**
[service-layer.md](service-layer.md), [fts5-full-text-search.md](fts5-full-text-search.md)
(shipped slices — the tools under test). Decision input for
[visual-extraction.md](visual-extraction.md) and
[vector-hybrid-search.md](vector-hybrid-search.md).

citation-needed exists to ground an LLM agent in **factual claims from papers a
researcher already holds** — Flow B, hallucination mitigation. The architecture
bet under question: the pipeline invests heavily in PDF→Markdown extraction
(~15 deterministic repair passes, the 2000-line quality scorer), but conversion
demonstrably loses information — display-equation structure, grouped table
headers, figure semantics ([visual-extraction.md](visual-extraction.md)).

Nothing today measures whether that loss matters downstream.
`score-markdown-quality` measures extraction fidelity against `pdftotext
-layout` pseudo-ground-truth; it does not measure whether an **LLM answers
claim-verification questions correctly** from each consumption surface. This
plan designs that eval.

## The fork this eval resolves

- If an LLM verifies claims just as accurately (and cheaply) from **raw PDFs**,
  the extraction code is over-investment and the service should serve PDFs or
  page regions instead.
- If **markdown** holds accuracy at a fraction of the tokens, extraction is
  validated and the parser scope should _expand_ (per
  [visual-extraction.md](visual-extraction.md)).
- If the **MCP retrieval layer** preserves accuracy at near-constant token cost
  regardless of corpus size, the service architecture is validated as the
  consumption surface and becomes the documented recommendation.

## Consumption modes under test

| Mode                     | Delivery                                                                      | Token economics per claim                      | Structural limit                                                                 |
| ------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| 1 `pdf-direct`           | Anthropic native PDF (text + page images) in context                          | whole PDF ≈ 2–4× markdown tokens (page images) | doesn't scale past a few papers; 100-page cap; must know _which_ paper to load   |
| 2 `markdown-context`     | extracted markdown in context                                                 | whole paper ≈ 15–25K tokens                    | same "which paper?" problem; corpus-in-context breaks at tens of papers          |
| 3 `mcp-agent`            | tool loop: `search-citations` → `read-content` → `verify-quote`               | a few chunks per claim, ~O(1) in corpus size   | accuracy bounded by lexical FTS retrieval + markdown fidelity                    |
| 3.5 hybrid _(candidate)_ | MCP locates via markdown index, serves original **PDF page images** on demand | retrieval-priced locating + PDF-priced reading | new tool (`read-page-image` via `pdftoppm`); built only if the results demand it |

The structural insight the modes table encodes: claim verification is **many
small queries against a corpus where the containing paper is unknown**. Modes
1–2 pay the whole corpus per claim (or need an oracle for which paper to load);
mode 3's cost is flat in corpus size. So the questions are (a) does markdown
lose _accuracy_ vs PDF per paper, (b) does retrieval preserve that accuracy
corpus-wide, and (c) where markdown loses, is the fix parser expansion or
hybrid page-image serving.

## Tenet check

The charter says the search core stays deterministic and LLM features live
outside it. The eval is entirely outside: a top-level `eval/` directory,
excluded from the Jest suite and the coverage ratchet, hitting the Anthropic
API with real keys. `npm test` never touches it. The eval _consumes_ the
production pipeline (`reextractMarkdownFromPdfFolder`, `createMcpServer`)
without modifying it.

## Phase 0 — token economics (free, run first)

Before any accuracy eval: analytic cost curves per mode. Token-count each
corpus paper as PDF (via the `count_tokens` endpoint with a document block) and
as markdown; compute cost-per-claim vs corpus size (1 → 8 → extrapolated
50/200 papers) per mode, with and without prompt caching. Zero eval spend, and
it answers the "least tokens" half of the question on its own — including
whether modes 1–2 are even candidates at field-scale corpora.

## Corpus

8 arXiv papers (pilot: 3) selected to cover the known failure classes, drawn
from the existing velocity.report set:

- **Liang2020 / LaneGCN** — the documented worst case (mangled Eq. 10, dropped
  end-of-paper figures, grouped-header tables).
- One equation-dense, one table-dense, one figure-dependent paper.
- One short clean-prose paper as the mode-invariance control.

Nothing checked in except `eval/corpus/manifest.json` — `{ arxivId, pinned
version, sha256, doi, tags[] }`. PDFs are fetched by arXiv id and
sha256-verified (extraction is deterministic, so pinned PDF ⇒ pinned markdown ⇒
stable eval input). Markdown is rebuilt via the production path
(`reextractMarkdownFromPdfFolder` in `src/services/markdown-extraction.ts`) and
indexed into an eval-only SQLite DB via `getDatabase(dbPath)`. Per-paper
`score-markdown-quality --json` output is persisted for the fidelity
correlation below. A scanned/OCR paper is deferred — the pipeline has no OCR
path, so its result is known a priori.

## Task suite — claim verification, not generic QA

Each item is a **claim + gold verdict (`supported` / `refuted` / `not-found`) +
gold evidence location** (page + verbatim span). Categories map to the failure
classes and to the hallucination-mitigation mission:

| Category                | Probes                                                                | Expected signature                                               |
| ----------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Verbatim claims         | exact sentences from papers                                           | all modes should find; mode 3 has `verify-quote`                 |
| Paraphrased claims      | semantically supported, different wording                             | stresses lexical FTS (no embeddings) vs full-context reading     |
| Numeric/table claims    | "LaneGCN achieves minADE 1.71 at K=6" + perturbed-number refuted twin | markdown hurt by flattened grouped headers                       |
| Equation claims         | "the loss applies the norm inside the sum"                            | markdown hurt by lost sub/superscripts                           |
| Figure-dependent claims | content only visible in figures                                       | markdown/MCP near floor — measures the ceiling vision would buy  |
| **Absent claims**       | plausible, in-domain, in no corpus paper                              | **the core hallucination probe** — correct answer is `not-found` |
| Attribution claims      | "X was shown in paper P" (actually paper Q)                           | corpus-wide; where modes 1–2 structurally break                  |

~15 claims per paper + ~10 corpus-level ≈ **130 items** — enough for paired
per-claim comparisons (McNemar / bootstrap) to detect the ~15 pp differences
that would change the roadmap; finer resolution is not chased.

**Authoring:** LLM-drafted with page number and verbatim evidence span,
human-verified before entering the suite (verification depth decided at
scheduling, alongside spend). A wrong gold verdict silently corrupts every
downstream number, so no unverified item counts.

**Grading is mechanical everywhere.** Models answer through a fixed structured
output schema `{ verdict, evidence?, confidence }`; grading is verdict
classification plus an evidence check reusing `normalizeForMatch` /
`VerifyQuoteService` (`src/services/verify-quote.ts`). No LLM judge in v1.

## Harness

Top-level `eval/` — outside `src/` (coverage ratchet) and `test/` (Jest; add
`/eval/` to `testPathIgnorePatterns` as belt-and-braces). One runner, one
`ModeAdapter` interface, three adapters — mode is the only variable; claim,
schema, and grading are identical, so any delta is attributable to the
consumption surface.

- **pdf-direct / markdown-context** — single Anthropic SDK call with the
  document or markdown block plus the claim.
- **mcp-agent** — an MCP `Client` connected to `createMcpServer(db)`
  (`src/mcp/server.ts`) over `InMemoryTransport` — in-process, exercising the
  exact production tool handlers — driven by a manual tool loop (~60 lines,
  fully observable token accounting; deliberately not the Agent SDK, which
  brings its own tools and blurs accounting).
- **Models:** two — a cheap model (amplifies input-quality differences) and a
  mid-tier model (shows whether strength papers over conversion damage). Model
  ids are config strings.
- **Cost controls:** replay cache keyed on request hash (reruns free), prompt
  caching per (paper, mode) group, and a `maxCostUsd` abort guard. Spend
  approval is decided at scheduling; the pilot is designed to stay under a few
  dollars.
- **Output:** JSONL per (claim × mode × model) — verdict, grade, usage,
  latency, tool transcript — plus a report mirroring `score-markdown-quality`'s
  summary/`--json` style, with a `--fail-below-baseline` gate.

## Metrics

1. Verdict accuracy per (category × mode × model); paired per-claim deltas
   with bootstrap CIs, not point estimates.
2. **False-`supported` rate on absent claims** — the headline hallucination
   number; the failure this tool exists to prevent.
3. Tokens and USD **per correct verdict** (the "most accurate, least tokens"
   axis), and latency.
4. Evidence-reached rate (mode 3, from tool transcripts): a wrong verdict
   _with_ the gold evidence retrieved is a reasoning failure; _without_ it, a
   retrieval/chunking failure. Routes the fix.
5. Fidelity correlation: per-paper `score-markdown-quality` sub-scores vs the
   per-paper (mode 1 − mode 2) accuracy gap — validates or invalidates the
   existing metric as a cheap proxy for downstream harm.

## Pre-registered decision rules

Written here _before_ any run so results cannot be rationalized afterward:

| Observation (full corpus, cheap model)                                   | Roadmap action                                                                                                                                 |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Mode 2 ≈ mode 1 within CI everywhere except figures                      | **Markdown validated**; extraction investment justified; deprioritize visual extraction except figure enrichment                               |
| Mode 1 beats mode 2 ≥ 15 pp on equation/table claims                     | Expand the parser per [visual-extraction.md](visual-extraction.md) (Nougat pass) — or build hybrid 3.5 if Phase-0 favors it                    |
| Mode 1 beats mode 2 even on prose claims                                 | Conversion loses more than layout features: audit repair passes; hybrid page-image serving becomes the default candidate                       |
| Mode 3 ≈ mode 2 accuracy at ≪ tokens, wins corpus-wide/absent categories | **MCP service architecture validated**; document as the recommended surface                                                                    |
| Mode 3 < mode 2 with low evidence-reached rate                           | Fix retrieval first — chunking (`src/services/chunker.ts`), FTS query construction, revisit [vector-hybrid-search.md](vector-hybrid-search.md) |
| Fidelity correlation strong (ρ ≳ 0.6 on relevant sub-scores)             | Keep `score-markdown-quality` as the per-commit gate; run the LLM eval on releases only                                                        |
| Fidelity correlation ≈ 0                                                 | The scorer does not predict downstream harm: recalibrate its weights against these results                                                     |

The mode-2 eval additionally becomes the **regression gate** for extractor
changes: rebuild markdown for the corpus, skip papers whose bytes are
unchanged, re-run mode 2 on changed papers only (replay cache makes unchanged
answers free), compare per-category accuracy against a checked-in baseline via
`--fail-below-baseline` — the same shape as `--fail-below` today.

## Phasing

1. **Phase 0 — token economics.** Free, no approval needed; answers the cost
   axis analytically.
2. **Pilot.** 3 papers × ~20 claims, modes 1–2, one model, a single script,
   manual grading (< $2). Exit question: are the deltas visible and the claim
   formats gradable? If mode 1 ≈ mode 2 even on Liang2020 equations, revisit
   claim difficulty before building more.
3. **Phase 1.** Full modes 1–2 harness: corpus builder, adapters, structured
   output, mechanical grading, replay cache, report.
4. **Phase 2.** Mode 3 adapter, corpus-wide claims, tool-transcript capture,
   evidence-reached metric.
5. **Phase 3.** Fidelity-correlation analysis, decision memo against the rules
   above, regression-gate baseline.

Deferred: scanned/OCR paper, LLM-judge grading, Batches API runs, more than two
models, stdio-subprocess transport, hybrid 3.5 implementation (only if the
rules trigger it).

## Non-goals

- No LLM calls inside the deterministic core, the Jest suite, or CI's default
  path — the eval is invoked deliberately.
- Not a general model benchmark: models are held constant to compare
  consumption surfaces, not vendors.
- No unverified ground truth: an item that hasn't been human-checked does not
  count toward any number.
