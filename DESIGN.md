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
disagree, the rule wins or the rule changes, not silently and not case by
case.

---

## Retrieval and access

> Serves: _relevance is not identity_, _legitimate access, deliberate
> disclosure_, _every stage is honest_, _a wrong answer is worse than no
> answer_.

**The cascade is `cache → Unpaywall → Semantic Scholar → arXiv → publisher →
authenticated`** (`src/retrieval/index.ts`). A stage joins only when it resolves
real, test-backed PDF URLs; parked stages are unexported and unwired. See
[docs/plans/retrieval-pipeline.md](docs/plans/retrieval-pipeline.md), which also
tracks the one stage still violating that rule (`publisher`, whose adapters
resolve no URLs).

**DOI-keyed sources run before title search.** A DOI names exactly one paper; a
title search is a guess that has to be validated. Precise sources first also
spares the fuzzy one a request.

**Verify identity before accepting any candidate.** Upstream search ranks by
relevance, always returns something, and has no idea what we asked for, and a
DOI lookup can still carry wrong metadata. Every source checks the title through
`src/retrieval/title-match.ts`, and the _best_ candidate is chosen, never the
first. Two thresholds, because the evidence differs:

| Lookup                               | Threshold                      | Why                                                                                |
| ------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------- |
| By title (arXiv)                     | `TITLE_SEARCH_THRESHOLD` (0.9) | The title is the _only_ evidence of identity, so near-misses must be refused       |
| By DOI (Unpaywall, Semantic Scholar) | `DOI_LOOKUP_THRESHOLD` (0.5)   | The DOI already proves identity; the title only guards against wrong upstream data |

The strict bar will refuse real matches whose preprint title drifted, and that is
the correct trade. Applying it to a DOI lookup is not: it rejects papers whose
BibTeX subtitle is merely abbreviated.

**A throttled lookup is not a missing paper.** Every upstream rate-limits, and a
429 that escapes a resolver reads as "no PDF found", indistinguishable from a
paper the source does not have. Retry with backoff (`src/retrieval/http-retry.ts`:
`Retry-After` when offered, else exponential; 429 and 5xx), and surface an
exhausted budget as an error, never as an empty result.

**Carry "throttled" out as a flag, not a phrase.** `RetrievalResult.throttled`
says this DOI was refused before it was looked up, so waiting changes the answer,
unlike a paper no source has. Callers decide what to retry from that flag;
nothing downstream should be parsing a message string to find out.

**Back off from a refusal; do not retry into it.** When a source rate-limits in
streaks, per-DOI retries add load to a throttle we are already inside. Trip a
breaker, stop calling that source, and retry the queue **once** after a cooldown
(`THROTTLE_COOLDOWN_MS`) with the breaker cleared. One extra pass, never a loop.

**A breaker pauses a source; it does not write one off.** Throttling is a
passing streak, not a property of the run, so an open breaker must cool down and
then let a single probe through, closing again when the pool answers. A breaker
that stays open for the whole run trades every paper only that source carries for
the hammering it prevented, which is the worse half of the deal.

**Quote every phrase sent to a search API.** An unquoted multi-word value is
split and OR-ed across all fields by arXiv, which matches most of the corpus and
ranks an unrelated paper first. Quoting is not cosmetic; it is the difference
between a query and a wish.

**Never fake a stage that is not configured.** Unpaywall needs a contact email
and rejects placeholder domains outright, so an `@example.com` address is treated
as no address at all. The stage is skipped, and `attempts` says which command
fixes it. It does not silently degrade into something else, and it does not
spend a request on a guaranteed rejection.

**Be a good citizen on every request**: honour each host's published rate limit
rather than a guess (arXiv asks one request per 3s, not one per second), send a
`User-Agent` carrying a contact address, and use the user's own credentials (from
an env var, never stored) for institutional proxies.

**Log every attempt** to `retrieval_log` with its source and URL, success or
failure. The log is how a bad run gets diagnosed after the fact.

**Report what happened, not what is convenient.** A retrieval served from cache
is not a download. Counts must survive a reader asking "how many did it actually
fetch?"

## Dossier generation

> Serves: _the dossier is the product_, _report, don't review_, _models write,
> checks decide_, _independent models, not one oracle_, _provenance or it didn't
> happen_.

The design lives in [docs/plans/dossier.md](docs/plans/dossier.md); these are
the rules it must keep.

**Coverage sets the size.** A deterministic source profile runs before any
model call, and every section, display equation, figure, and table it lists
gets an entry. Prose budgets scale with the passage digested. No prompt asks for
a word count: a length target pads short sources and drops equations from long
ones.

**Reproduce the exact things.** Numbers, equations, captions, quotations, and
table values are copied from the source, never paraphrased or recomputed.
Captions are injected from the layout text, not generated. A number the source
never states is a finding, not a summary.

**Every generated item is checked or marked.** Quotes go through `verify-quote`
against the source's own chunks, numbers through the number gate, equations
through KaTeX and a layout cross-check, and coverage against the profile. A
failure stays in place, marked ⚑ with its reason. Nothing is dropped or
rewritten to make a check pass.

**Two transcriptions or a flag.** Every display equation is transcribed by the
`math` role and again by the `auditor` role from a different family. Agreement
passes; disagreement keeps both and flags.

**The auditor flags; it never edits.** The writer gets one revision pass over
flagged lines, and whatever still fails stays marked. One pass, never a loop.

**The footer is rendered, never generated.** Code builds it from `model_runs`,
`manifestations`, `retrieval_log`, and the check results, with a fixed preamble
and fixed fields, so every dossier's footer reads the same and none of it is a
model's claim about itself.

**Generated content never touches the evidence layer.** Transcriptions,
descriptions, and digests live in dossier parts. The extracted Markdown stays
byte-identical whether or not a dossier ran, and `verify-quote` never checks
against a dossier.

**Pin what ran.** Each model run records the resolved model name the provider
reported, the prompt-set hash, the input hash, and the temperature. A call that
matches a prior successful run reuses its output, so a resumed job never pays
twice.

## Model providers and secrets

> Serves: _legitimate access, deliberate disclosure_, _independent models, not
> one oracle_, _one definition, thin adapters_.

The design lives in
[docs/plans/model-providers.md](docs/plans/model-providers.md).

**Code asks for a role, never a model.** `reader`, `math`, `figure`, `writer`,
and `auditor` are assigned to provider and model pairs in config. A role whose
job needs images must be assigned a vision model; an auditor from the same
family as the reader or writer is a recorded warning.

**Two adapters, three providers.** Anthropic speaks the Messages API; OpenRouter
and Ollama are two configurations of one OpenAI-compatible adapter. Both use the
shared retry policy in `http-retry.ts`. No vendor SDKs, no LLM framework.

**Keys live in one file, and only there.** `~/.citation-needed/secrets.json`,
mode 0600, written atomically. A group- or world-readable secrets file is
refused. An environment variable wins over the file. Keys never enter SQLite,
logs, errors, job payloads, dossiers, or HTTP responses; the API reports a
masked hint, and the UI can set, replace, or delete a key but never read one
back.

**Say where the source goes.** The settings page shows, per role, whether its
input leaves the machine. An all-local assignment must run without network
access.

**Restricted sources need consent per dossier.** A source whose `access_type`
is not `open-access` reaches a remote provider only after the user confirms it
for that dossier, or runs on local roles alone. There is no global override.
The confirmation and the reported licence are printed in the footer.

**One key is enough to start.** With a single provider configured, every role
defaults to it, and the footer records that the audit was not independent.

**Cap the spend.** A per-dossier token cap pauses the job before the call that
would cross it. Pausing is visible and resumable; overrunning silently is not
an option.

## Web surface

> Serves: _one definition, thin adapters_.

**SvelteKit and svelte-ux, used as documented.** Pages are Svelte components
built from svelte-ux, in the `web/` workspace. SvelteKit runs under adapter-node
inside the `serve` process, never as a static export. Svelte files are
`.svelte`, so `.tsx` keeps meaning live terminal redraw (see
[Terminal output](#terminal-output)). Live progress is Server-Sent Events from
the job event bus; persisted rows are the source of truth on reload.

**One context per process.** `serve` creates the database, services, worker,
and event bus once and hands them to SvelteKit through the request. Web code
imports only types from `src/`. A second copy of the services bundled into the
web build would hold its own database handle and event bus, and progress events
would never reach the page.

**No logic in `web/`.** Endpoints parse with the shared zod contract, call a
service, and return JSON; pages read through the same `/api/v1` endpoints.
Logic in `web/` would escape the Jest coverage ratchet, so it belongs in a
service.

**A local server is still a server.** Loopback bind, a `Host` allowlist against
DNS rebinding, a startup token exchanged for a `SameSite=Strict` session cookie,
and no CORS headers. A non-loopback bind requires a bearer token. See
[docs/plans/http-api.md](docs/plans/http-api.md#security).

**Math renders with the library that checks it.** KaTeX typesets equations in
the UI and is also the LaTeX gate, bundled rather than loaded from a CDN so the
UI works offline.

## Terminal output

> Serves: _one definition, thin adapters_.

**`.tsx` means React, and React means live redraw.** That is the whole rule.

| Location   | Renderer                             | Why                                         |
| ---------- | ------------------------------------ | ------------------------------------------- |
| `src/tui/` | Ink / React                          | Output that redraws while work is in flight |
| `src/cli/` | Plain writes via `src/cli/output.ts` | Everything else                             |

Exactly one component qualifies: `ImportProgress`, a spinner plus a list of rows
mutating as an import runs. Hand-rolling cursor control for that is genuinely
worse than a reconciler.

**Static output never goes through Ink.** A one-shot line does not need a
reconciler, and Ink's yoga layout hard-wraps at the measured terminal width,
inserting real newlines that break copy-paste of file paths. Plain writes let
the terminal soft-wrap. Ink for static text costs more and produces worse
output.

**All CLI writes go through `src/cli/output.ts`**, the single sanctioned place
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
with it. It never goes down. If a change needs the floor lowered, the change
needs tests instead.

**Assert behaviour, not plumbing.** Assert what a command _printed_, not the
props of an element it constructed. A test that inspects internal wiring passes
while the user-visible output is broken.

**Assert on visible text, never on raw bytes.** Rendered output carries ANSI
escapes only sometimes: `jest --colors` sets `FORCE_COLOR=1` in worker
processes, so the same assertion passes piped and fails in an editor. Put
rendered output through `stripAnsi` (`test/helpers/ansi.ts`) and measure width
with `visibleWidth`; escapes occupy no columns. A test whose result depends on
where it was run is not a test.

**A test that encodes a bug is worse than no test.** When a fix makes a test
fail, decide which of the two is wrong before touching either: a green suite
asserting the wrong format is how a defect becomes a specification.

**Every fixed bug gets a regression test named for the failure**, with a comment
stating the concrete scenario. "Rejects an unrelated first result" beats
"validates input".

**Use real SQLite in per-suite `mkdtemp` directories.** Parallel Jest workers
race on a shared fixture dir. A real database catches cascade and trigger
behaviour that a mock cannot.

**Network is mocked in tests.** Live API checks are done by hand when a fix
depends on real upstream behaviour, and the result is recorded in the PR. A
suite that reaches the network is a suite that fails on a train. Model calls are
no exception: adapters and dossier stages run against recorded responses, and
dossier quality is measured by the eval harness in `eval/`, outside Jest.

## Structure and docs

> Serves: _one definition, thin adapters_, _models write, checks decide_.

**One service layer, one surface first per capability.** Dossiers bind to the
web UI first; the grounded search tools bind to MCP. Other surfaces are thin
gateways over the same operations, never parallel implementations. Temporary
duplication states its end date.

**Single source of truth per concept**: `manifestations` for file locations,
not a second path column drifting alongside it.

**Docs describe current state in the present tense.** No decision logs, no
"previously we…", no date-stamped reframing. Git carries the history; these
files carry the design.

**Plans live in [docs/plans/](docs/plans/README.md)** with an explicit status,
and backlog items reference them rather than restating them.
