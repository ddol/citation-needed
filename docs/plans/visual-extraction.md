# Visual extraction: equations, figures, complex tables

| Field      | Value                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Status     | **Core: slice 6**                                                                                                                          |
| Flow       | Dossier                                                                                                                                    |
| Depends on | the `verification/` extraction pipeline (pdf2md + `pdftotext -layout`), [model-providers.md](model-providers.md), [dossier.md](dossier.md) |

## Intent

Three parts of a PDF resist the deterministic text pipeline: **display
equations**, **figures**, and **grouped-header tables**. Their meaning lives in
layout and pixels, not in a linear character stream. They are also where a
dossier reader most needs help and where generated content is most likely to be
confidently wrong. This plan pairs each vision-model stage with deterministic
checks, so a reproduced equation or a described diagram arrives with evidence
or with a flag.

## Current state

Scored against `Liang2020.pdf` (LaneGCN):

- **Equations**: `pdf2md` mangles display math (Eq. 10's piecewise `d(x_i)`
  becomes `( 0.5x2i if kxi k < 1 d(xi ) =`). `pdftotext -layout` keeps the line
  nearly intact but has no LaTeX structure. `layout-equations.ts` reconstructs
  labelled equations from layout tokens and replaces them only when
  `isConfidentReconstruction` passes.
- **Figures**: captions survive for in-body figures; end-of-paper figures can be
  dropped or land as placeholders. Nothing describes what a figure shows.
- **Grouped tables**: `layout-tables.ts` (`packedGroupedTableToMarkdown`)
  decomposes two-row headers into real pipe tables. Tables it cannot align have
  no fallback.
- `markdown.ts` already maps figures and equations to pages
  (`figureCaptionsForLayout`, `equationPagesForLayout`).

## Design

### Locate (deterministic)

The dossier's profile stage lists every region:

- each display equation: label, page, layout line, and the deterministic
  reconstruction when it is confident;
- each figure: number, verbatim caption, page, and the paragraphs that cite it
  (`Fig. N`, `Figure N`);
- each table `layout-tables.ts` could not align: page and caption.

Equations are cropped to their layout lines, using word boxes from `pdftotext
-bbox-layout`, padded. Figures are sent as the full page with the caption
naming the target: a vision model finds "Figure 3" on a page more reliably than
a caption-adjacency heuristic crops it.

### Rasterize (deterministic)

`pdftoppm -f N -l N -r 200 -png`, cropping with `-x -y -W -H` for equations.
Poppler is already required for `pdftotext`, so no image library joins the
dependencies. Output is cached by PDF sha256, page, box, and resolution.

### Math stage

The `math` role transcribes each equation image to LaTeX: exact transcription,
no simplification, source numbering kept as `\tag{n}`. Its output then passes:

1. **LaTeX gate**: KaTeX parses it.
2. **Layout cross-check**: the symbol multiset of the KaTeX-tokenized LaTeX
   overlaps the `normalizeMathGlyphs` layout line above a threshold. This
   catches a transcription of the wrong equation or invented terms.
3. **Second transcription**: the `auditor` role, from a different model family,
   transcribes the same image. The two are compared after removing
   presentation-only commands (spacing, `\left`/`\right`, redundant braces).
   Agreement passes. Disagreement flags the equation and keeps both, with the
   deterministic reconstruction as a third reference when one exists.

A confident deterministic reconstruction that agrees with both models is the
strongest evidence the pipeline can produce, and the footer counts it.

Symbol meanings come from the `reader` role, which extracts definitions from
the text ("where $x_i$ denotes …") with a verbatim quote each; the quote gate
checks them.

### Figure stage

The `figure` role receives the page image, the caption, and the citing
paragraphs, and returns a structured description:

```json
{
  "kind": "plot | diagram | architecture | photo | table-image | other",
  "elements": {
    "axes": [],
    "series": [],
    "components": [],
    "flows": [],
    "labels": []
  },
  "description": "2–6 sentences: what is drawn, no interpretation beyond the caption and the citing text"
}
```

Checks: the caption is injected from the layout text, never generated. Labels
the model reports must appear in the page's text layer when the figure is
vector; raster figures skip this check and the footer says so. Numbers in the
description pass the number gate against the source text and the page text
layer. The auditor flags interpretation that goes past the caption and text.

### Tables

Deterministic first. A table `layout-tables.ts` cannot align goes to the
`figure` role as an image and returns a Markdown table; every cell value must
appear in the page's text layer, or the cell is flagged.

### Output contract

**Generated content lives in dossier parts, never in the extracted Markdown.**
The extracted Markdown is byte-identical whether or not these stages ran, so
FTS, `verify-quote`, and `score-markdown-quality` stay deterministic. Each
transcription and description is a `dossier_parts` row pointing at the
`model_runs` row that produced it.

## Rejected alternatives

- **Nougat for equations and tables.** CC-BY-NC license, a Python runtime, and
  whole-page repetition failures. A vision model behind the provider layer
  covers the same need, locally through Ollama when wanted.
- **BLIP captions for figures.** One-line captions ("a graph with lines") are
  far below the bar a dossier sets.
- **Mathpix.** Paid and single-purpose; reconsider only if the eval shows
  vision models fall short on equations.
- **Splicing generated content into extracted Markdown.** It would make the
  evidence layer nondeterministic.
- **Heuristic figure cropping.** Caption adjacency fails on multi-panel and
  side-captioned figures; the full page plus the caption is cheap and robust.

## Phasing

1. **Rasterizer and region list**: pure, tested against a fixture PDF, no model.
2. **Math stage**: transcription, LaTeX gate, layout cross-check, second
   transcription.
3. **Figure stage**: structured descriptions, caption injection, label check.
4. **Table fallback**: image to Markdown table with cell checks.
5. **Measurement**: equation agreement and figure coverage metrics feed the
   dossier eval.

## Backlog items

- [verify] M - Region rasterizer: equation crops from pdftotext -bbox-layout word boxes, figure pages, unaligned-table pages; pdftoppm PNGs cached by sha256/page/box/dpi (see docs/plans/visual-extraction.md)
- [model] L - Math stage: math-role LaTeX per display equation; KaTeX parse gate; layout symbol cross-check; auditor-role second transcription with normalized agreement (see docs/plans/visual-extraction.md)
- [model] L - Figure stage: structured description from page image + caption + citing paragraphs; injected verbatim captions; text-layer label check (see docs/plans/visual-extraction.md)
- [model] M - Table fallback: image to Markdown table for tables layout-tables cannot align, every cell checked against the page text layer (see docs/plans/visual-extraction.md)

## Testing

- Rasterizer: fixture PDF, expected page count and crop dimensions; cache hit on
  a second call.
- Math gates with recorded model outputs: a valid matching transcription passes;
  unparseable LaTeX, a wrong-equation transcription (low symbol overlap), and
  two disagreeing transcriptions each flag with the right reason.
- Agreement normalizer: presentation-only differences compare equal; a dropped
  subscript does not.
- Figure checks: an injected caption survives model output that rewrites it; a
  label absent from a vector figure's text layer flags.
- Extracted Markdown is byte-identical before and after the visual stages run.

## Relationship to other plans

- [dossier.md](dossier.md): these stages produce its mathematics, figures, and
  table parts.
- [model-providers.md](model-providers.md): the `math`, `figure`, and `auditor`
  roles.
- [claim-grounding-eval.md](claim-grounding-eval.md): Liang2020 and the pilot
  corpus are the first measurement set.
