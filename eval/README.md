# Claim-grounding eval

Measures whether an LLM verifies factual claims from a paper more accurately
from raw PDFs, from extracted markdown, or through this service's MCP retrieval
layer. Design and pre-registered decision rules:
[docs/plans/claim-grounding-eval.md](../docs/plans/claim-grounding-eval.md).

This tree is deliberately outside `src/` (no coverage ratchet) and `test/` (not
run by Jest; `/eval/` is in `testPathIgnorePatterns`). It hits the Anthropic API
with a real key. `npm test` and CI never touch it.

## Layout

```
eval/
  corpus/manifest.json     pilot papers, pinned by sha256 (PDFs not checked in)
  lib/tokens.ts            deterministic token estimator (+ optional count_tokens)
  phase0/economics.ts      per-claim cost model per mode x corpus size
  phase0/run.ts            Phase 0 runner -> report.md + report.json
  phase0/report.md         generated Phase 0 findings
  pilot/claims.jsonl       claim suite (seed set; PDF-sourced evidence spans)
  pilot/grade.ts           mechanical grader (verdict primary, evidence secondary)
  pilot/run.ts             pilot runner: pdf-direct vs markdown-context
```

The corpus lives in the sibling `velocity.report` repo; the manifest pins each
PDF by sha256 so a pinned PDF yields pinned markdown yields stable eval input.

## Phase 0: token economics (free, offline)

```
npx ts-node --transpile-only eval/phase0/run.ts
```

No key needed. Writes `eval/phase0/report.md`. With `ANTHROPIC_API_KEY` set it
also calls `count_tokens` (billed at zero) to replace estimated markdown counts
with exact ones; the curves and conclusions do not change.

## Pilot: pdf-direct vs markdown-context

Offline smoke test (canned perfect answers; verifies the grader and that the
claim formats are gradable, zero spend):

```
npx ts-node --transpile-only eval/pilot/run.ts --dry
```

Real run needs **both** of these, which are not present by default:

1. `npm i -D @anthropic-ai/sdk`
2. `export ANTHROPIC_API_KEY=...`

```
npx ts-node eval/pilot/run.ts --model claude-haiku-4-5-20251001 --max-usd 2
```

`--max-usd` (default 2) aborts the run before it overspends; a replay cache
under `eval/pilot/.cache/` makes reruns free.

## Status

- **Phase 0:** complete, offline. See `phase0/report.md`.
- **Pilot:** harness complete and verified offline; the scored run is blocked on
  the SDK + API key above. The claim suite is a **seed set** (17 items),
  PDF-sourced but not yet independently human-verified, and thin on
  equation/figure claims; expand toward ~60 and verify before the scored run.
