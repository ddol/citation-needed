```
   ██████╗ ███████╗███████╗██╗ ██████╗ ███╗   ██╗
   ██╔══██╗██╔════╝██╔════╝██║██╔════╝ ████╗  ██║
   ██║  ██║█████╗  ███████╗██║██║  ███╗██╔██╗ ██║
   ██║  ██║██╔══╝  ╚════██║██║██║   ██║██║╚██╗██║
   ██████╔╝███████╗███████║██║╚██████╔╝██║ ╚████║
   ╚═════╝ ╚══════╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝
              how the tenets become code
```

# Design guidelines

Concrete rules. Each one exists to serve a tenet in [TENETS.md](TENETS.md); the
tenet is the reason, and this is the shape. Where a rule and a convenience
disagree, the rule wins or the rule changes — not silently, and not case by
case.

---

## Retrieval and access

> Serves: _relevance is not identity_, _legitimate access only_, _every stage is
> honest_, _a wrong answer is worse than no answer_.

**The active cascade is `cache → Unpaywall → arXiv → authenticated`.** A stage
joins only when it resolves real, test-backed PDF URLs. Parked stages are
unexported and unwired — see
[docs/plans/retrieval-pipeline.md](docs/plans/retrieval-pipeline.md).

**Verify identity before accepting any candidate.** Upstream search ranks by
relevance, always returns something, and has no idea what we asked for. arXiv
candidates must clear `ARXIV_TITLE_MATCH_THRESHOLD` (normalized Levenshtein
similarity, `src/retrieval/resolvers/arxiv.ts`) against the citation title, and
the _best_ candidate is chosen — never the first. The threshold is deliberately
conservative: it will refuse real matches whose preprint title drifted, and
that is the correct trade.

**Quote every phrase sent to a search API.** An unquoted multi-word value is
split and OR-ed across all fields by arXiv, which matches most of the corpus and
ranks an unrelated paper first. Quoting is not cosmetic; it is the difference
between a query and a wish.

**Never fake a stage that is not configured.** Unpaywall needs a contact email.
Without one the stage is skipped and says so in `attempts` — it does not silently
degrade into something else.

**Be a good citizen on every request**: rate-limit per host, send a `User-Agent`
carrying a contact address, and use the user's own credentials (from an env var,
never stored) for institutional proxies.

**Log every attempt** to `retrieval_log` with its source and URL, success or
failure. The log is how a bad run gets diagnosed after the fact.

**Report what happened, not what is convenient.** A retrieval served from cache
is not a download. Counts must survive a reader asking "how many did it actually
fetch?"

## Terminal output

> Serves: _one definition, thin adapters_.

**`.tsx` means React, and React means live redraw.** That is the whole rule.

| Location   | Renderer                             | Why                                         |
| ---------- | ------------------------------------ | ------------------------------------------- |
| `src/tui/` | Ink / React                          | Output that redraws while work is in flight |
| `src/cli/` | Plain writes via `src/cli/output.ts` | Everything else                             |

Today exactly one component qualifies: `ImportProgress` — a spinner plus a list
of rows mutating as an import runs. Hand-rolling cursor control for that is
genuinely worse than a reconciler.

**Static output never goes through Ink.** A one-shot line does not need a
reconciler, and Ink's yoga layout hard-wraps at the measured terminal width,
inserting real newlines that break copy-paste of file paths. Plain writes let
the terminal soft-wrap. Ink for static text costs more and produces worse
output.

**All CLI writes go through `src/cli/output.ts`** — the single sanctioned place
for `console`. It honours `NO_COLOR`, `FORCE_COLOR`, and TTY detection.

**Errors go to stderr and set `process.exitCode`.** stdout stays pipeable; a
failed command exits non-zero. The primary consumer is an agent, and an agent
cannot see red text.

**Compute layout before colour.** Padding and truncation run on plain strings so
ANSI escapes never count toward a column width.

## Testing

> Serves: _a wrong answer is worse than no answer_, _provenance or it didn't
> happen_.

**Coverage is a ratchet.** The floor in `jest.config.js` sits just below actual
coverage so any regression fails CI. When real coverage rises, the floor rises
with it. It never goes down — if a change needs the floor lowered, the change
needs tests instead.

**Assert behaviour, not plumbing.** Assert what a command _printed_, not the
props of an element it constructed. A test that inspects internal wiring passes
while the user-visible output is broken.

**A test that encodes a bug is worse than no test.** When a fix makes a test
fail, decide which of the two is wrong before touching either — a green suite
asserting the wrong format is how a defect becomes a specification.

**Every fixed bug gets a regression test named for the failure**, with a comment
stating the concrete scenario. "Rejects an unrelated first result" beats
"validates input".

**Use real SQLite in per-suite `mkdtemp` directories.** Parallel Jest workers
race on a shared fixture dir. A real database catches cascade and trigger
behaviour that a mock cannot.

**Network is mocked in tests.** Live API checks are done by hand when a fix
depends on real upstream behaviour, and the result is recorded in the PR — a
suite that reaches the network is a suite that fails on a train.

## Structure and docs

> Serves: _one definition, thin adapters_, _the core stays deterministic_.

**One service layer, MCP first.** Other surfaces are thin gateways over the same
operations, never parallel implementations. Temporary duplication states its end
date.

**Single source of truth per concept** — `manifestations` for file locations,
not a second path column drifting alongside it.

**Docs describe current state in the present tense.** No decision logs, no
"previously we…", no date-stamped reframing. Git carries the history; these
files carry the design.

**Plans live in [docs/plans/](docs/plans/README.md)** with an explicit status,
and backlog items reference them rather than restating them.
