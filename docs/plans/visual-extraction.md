# Visual extraction: equations, figures, complex tables

**Status:** Exploratory · **Flow:** Infrastructure · **Depends on:** the current
`verification/` extraction pipeline (pdf2md + `pdftotext -layout`).

Three parts of a PDF resist the deterministic text pipeline: **display
equations**, **figures**, and **grouped-header tables**. They fail for the same
reason — their meaning lives in _layout and pixels_, not in a linear character
stream — so they are grouped into one plan with one shared pipeline rather than
three ad-hoc fixes.

This is the honest ceiling of the heuristic passes in
[`verification/markdown.ts`](../../src/verification/markdown.ts) and
[`verification/layout-tables.ts`](../../src/verification/layout-tables.ts): they
recover _structure that survives in the text stream_. Equations, figure
semantics, and merged cells do not survive it, and no amount of regex recovers
what the extractor already discarded.

## Why now

Scored against `Liang2020.pdf` (LaneGCN), the current pipeline produces:

- **Equations** — `pdf2md` mangles display math (e.g. Eq. 10's piecewise
  `d(x_i)` becomes `( 0.5x2i if kxi k < 1 d(xi ) =`). `pdftotext -layout` keeps
  the same equation nearly intact on one line but still has **no LaTeX
  structure** — subscripts, superscripts, and stacked limits are lost in both.
- **Figures** — captions survive for in-body figures (Fig. 1–4) but never a
  description of _what the figure shows_; end-of-paper figures (Fig. 5–6) are
  dropped or land as placeholders.
- **Grouped tables** — Markdown has no colspan, so a two-row header
  (`Backbone | FusionNet | K=1 | K=6` over `ActorNet | MapNet | … | minFDE`)
  is flattened deterministically by `layout-tables.ts`
  (`packedGroupedTableToMarkdown`): it anchors on the single-space-packed leaf
  header, assigns each body mark/number monotonically (order survives even when
  `pdftotext -layout` compresses sparse `X` marks), and disambiguates duplicate
  leaf headers with their group label (`minADE (K=1)` vs `minADE (K=6)`).
  Pixel-level recovery stays the fallback only for tables this still can't align.

## Tenet check

The plans charter says **"the search core stays deterministic (LLM features live
outside it)."** A vision model's output is not reproducible byte-for-byte, so
this pipeline is an **optional enrichment pass that runs after** deterministic
extraction and is **off by default**. The FTS index, quote verification, and
`score-markdown-quality` must behave identically whether or not it ran. Enriched
content is additive and clearly attributed (see Output contract below).

## Options considered

| Option                                                               | Scope                                       | Cost                                      | License         | Fit                                                  |
| -------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------- | --------------- | ---------------------------------------------------- |
| **Nougat** (`facebookresearch/nougat`)                               | full page → Markdown w/ LaTeX math + tables | free, local (Python/ONNX) or HF Inference | **CC-BY-NC** ⚠️ | Best for **equations + tables**; trained on arXiv    |
| **transformers.js + BLIP** (`Salesforce/blip-image-captioning-base`) | image → caption                             | free, local Node/ONNX, no key             | BSD-3 / Apache  | Best for **figure descriptions**; pure JS, no Python |
| **SmolVLM / other small VLM via transformers.js**                    | image → richer VQA description              | free, local Node/ONNX                     | Apache          | Fuller figure descriptions than BLIP; heavier        |
| **Hosted multimodal LLM free tier** (e.g. Gemini free tier)          | image → description / math                  | free tier, rate-limited, API key          | vendor          | Highest quality, but a key + network + ToS           |
| **Mathpix**                                                          | page → LaTeX                                | **paid**                                  | commercial      | Most reliable math OCR; fails the "free" bar         |

### Recommendation

- **Equations + hard tables → Nougat**, run **per-page-region**, not whole-doc:
  we already know the page and bounding context of each unresolved equation/table
  from `pdftotext -layout`, so we rasterize only that region and ask Nougat for
  its markup. This sidesteps Nougat's ~1/500-page whole-page repetition failure
  and keeps runs cheap. **The CC-BY-NC license means this stays an opt-in dev
  tool, not a bundled default** — noted loudly so a commercial deployment does
  not inherit an NC dependency unaware.
- **Figures → transformers.js + BLIP** locally (zero key, zero network, pure
  Node). Upgrade path to SmolVLM for descriptions richer than a one-line caption.
- **Do not** put any of this in the deterministic core or make it a hard
  dependency. Package as an optional peer dependency, mirroring how Playwright is
  optional for authenticated download.

## Pipeline

```
deterministic extract (pdf2md + layout)          ← unchanged, always runs
        │
        ▼
find unresolved regions
  · equations missing/garbled  (equationsForLayout gap)
  · figures w/o description    (figureCaptionForLine)
  · tables layout-tables can't align
        │
        ▼   (only if enrichment enabled)
rasterize the page region  (pdftoppm / pdfium → PNG)
        │
        ├── equation/table region → Nougat  → LaTeX / md fragment
        └── figure region         → BLIP    → caption/description
        │
        ▼
splice fragment into Markdown, attributed, deterministic order
```

Region rasterization reuses the page numbers already computed by
`figurePagesForLayout` / `equationPagesForLayout` in `markdown.ts`, so no new
PDF-geometry code is needed on the locating side — only a region→PNG step
(`pdftoppm -f N -l N` crop, already have `pdftotext` from poppler).

## Output contract

Enrichment is **labelled and reproducible in placement** even though its text is
model-generated:

- Figure description:
  `> Figure description (BLIP): …model text…` under the caption.
- Equation recovered by Nougat: the `$$…$$` block, followed by
  `<!-- equation source: nougat -->`.
- Never overwrite a deterministically-extracted block; only fill a gap or append
  a description. A re-run with enrichment off must yield the byte-identical
  deterministic document.

## Phasing

1. **Region rasterizer** — `pdf region → PNG` helper in `verification/`, pure and
   tested against a fixture PDF. No model yet.
2. **Figures (BLIP, local)** — lowest risk, no Python, no NC license. Wire an
   optional `describe-figures` pass; gate behind a flag + missing-dependency
   guard like the extractor-version resolver already does.
3. **Equations/tables (Nougat)** — opt-in dev pass, CC-BY-NC guard, region-scoped
   calls. Feed the `score-markdown-quality` equation metrics to measure lift.
4. **Score integration** — extend `score-markdown-quality` to report
   before/after equation-`$$` coverage and figure-description coverage so the
   enrichment loop is measurable, not vibes.

## Non-goals

- Not a general OCR replacement — the deterministic path stays primary.
- No hosted paid APIs (Mathpix) and no always-on network calls.
- No bundling of a CC-BY-NC model into the default install path.
