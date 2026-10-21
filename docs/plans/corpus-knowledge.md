# Corpus knowledge: units, beliefs, and an autonomous loop

| Field      | Value                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status     | **Proposed**                                                                                                                                                                                                                                                                                                                                                                                    |
| Flow       | B (claims from papers already held); new sources arrive through C                                                                                                                                                                                                                                                                                                                               |
| Depends on | [fts5-full-text-search.md](fts5-full-text-search.md) and [domain-model.md](domain-model.md) (chunks, hashes, manifestations), [model-providers.md](model-providers.md) (roles, `model_runs`), [indexing-jobs.md](indexing-jobs.md) (job kinds, worker), [dossier.md](dossier.md) (reader role, gates), [vector-hybrid-search.md](vector-hybrid-search.md) (embed stage, adopted here for units) |

## Intent

A research group holds about 160 papers on roadside LiDAR perception and
road-safety behaviour (headway, time to collision, speed percentiles, crash
exposure), listed in a BibTeX file and fetched as PDFs. A weekly agent writes a
briefing on new sources, and the group works from a set of assumptions and
ground truths it has taken from those papers.

This plan gives the corpus a knowledge layer that maintains itself:

- **Units**: every checkable assertion in every paper (claim, assumption,
  result, method, limitation), anchored to a verbatim quote with page and
  section, one Markdown file each.
- **Relations**: how a unit in a new paper stands to units the corpus already
  holds (supports, contradicts, refines, out of scope).
- **Beliefs**: the assumptions, ground truths, thresholds, and definitions the
  group holds, each grounded in units and continuously re-checked against the
  corpus, with a status computed from the evidence.
- **A current view**: one tree holding the best available version of all of
  the above, so a reader never chooses between five runs of the same paper.

The loop runs unattended. New papers are picked up when they enter the BibTeX
file, and idle local compute re-checks beliefs and widens extraction. A human
acts only when a belief the group adopted is negated, which should happen a
handful of times a year.

Every generated artefact is immutable and tagged with the model, prompt set,
and schema that made it. A better model adds a version beside the old one.
Cheap work runs on open models offline; state changes others rely on go to
frontier models. That line is stated below and is the central design choice.

## Assumptions

- **Hardware**: an Apple M-series machine with 64 GB, or one 24 GB GPU. That
  runs a 30B-class open model at 4-bit at around 30 tokens per second and any
  embedding model instantly. A paper's unit extraction takes minutes, and the
  corpus backfills overnight. Two or three local model families are installed
  so local checks can be independent of each other.
- **Budget**: frontier spend of the order of $100 a month. The design states
  cost in tokens; the price table in config
  ([model-providers.md](model-providers.md)) converts, and a monthly cap pauses
  frontier work the way the per-dossier cap does. Local work is free in money
  and bounded by disk and time.
- **The corpus is its own git repository**: `references.bib`,
  `beliefs.yaml`, `topics.yaml`, configuration, escalation decisions, the gold
  set, and hand-reviewed briefings are tracked. `papers/` and `knowledge/` are
  ignored.
- **Scheduling stays outside the core.** Cron or launchd fires a tick; the
  worker under `serve` drains the queue it fills
  ([README.md](README.md#architecture-principles)).
- **About 25 units per paper**, so about 4,000 units, 15 to 20 topics, and a
  few hundred beliefs. Everything below is sized for ten times that.
- **Sources are PDFs the shipped pipeline extracts.** Scanned PDFs and non-PDF
  sources stay out of scope, as in [dossier.md](dossier.md).

## Where the model line falls

**Local models do any work that a deterministic gate or a second local model
family can refuse. Frontier models are called only for outputs that change
state the group relies on: negating a belief, upholding a contradiction,
proposing beliefs, and writing topic prose.**

Open models are cheap, and wrong more often. That is acceptable exactly where
something catches the wrong answer: a unit whose quote `verify-quote` cannot
find is refused, a number the source never states is refused, and a verdict
one local family reaches counts for little until a second family agrees.
Status changes are rare, so spending frontier tokens only there keeps the
monthly bill small while every consequential change gets the strongest check
available. Each frontier call gets the quotes and their conditions, never a
whole paper, because the evidence is already isolated.

| Work                                              | Model class                   | Refused by                                         |
| ------------------------------------------------- | ----------------------------- | -------------------------------------------------- |
| extract, profile, chunk, index                    | none (deterministic, shipped) | quality scorer                                     |
| embed chunks and units                            | open, local (`embedder`)      | candidate recall on the gold set                   |
| extract units from a section                      | open, local (`reader`)        | quote, number, and coverage gates; schema          |
| assign topics; screen candidate pairs             | open, local (`screener`)      | taxonomy (closed list)                             |
| judge a unit pair; check a unit against a belief  | open, local, two families     | the other family; deterministic status rules       |
| adjudicate a contradiction or a negation          | frontier (`judge`)            | an escalation to a human, for adopted beliefs only |
| propose beliefs from agreeing units and reports   | frontier (`writer`)           | the status rules: a proposal starts as `proposed`  |
| consolidate a topic                               | frontier (`writer`)           | quote and unit-citation gates                      |
| render snapshots, summaries, footers, escalations | none (deterministic)          | n/a                                                |
| migrate a schema version                          | none (deterministic)          | schema validation                                  |

The dossier roles carry over unchanged: `reader` extracts units for both the
dossier and this plan, `writer` composes, `auditor` provides another family.
Two roles are new: `judge` (frontier, text only) and `screener` (open, small).
`embedder` comes from [vector-hybrid-search.md](vector-hybrid-search.md). Local
judging uses a **family rotation** in config: two or more local models from
different vendors, so that local agreement means something.

Disclosure applies as it does for dossiers: a paper whose `access_type` is not
`open-access` sends nothing to a remote role, quotes included, until the user
confirms it for that paper. Local roles always run. Confirmation is recorded
on the paper's source record and printed in every artefact derived from it.

## Stages

```
  references.bib changes          cron: knowledge tick (hourly)
          │                                 │
          ▼                                 ▼
  acquire ─► extract ─► profile ─► chunk ─► fts-index            shipped / dossier
                │                    │
                ▼                    ├──► embed (chunks)         local
             units ◄─────────────────┘                           local + gates
                │
                ├──► embed (units) ──────┐                       local
                ▼                        ▼
           candidates ─► screen ─► judge (two local families)    local
                                         │
                       ┌─────────────────┼──────────────────┐
                       ▼                 ▼                  ▼
                 relations        belief checks       belief proposals
                       │         (append-only ledger)  (frontier, bootstrap
                       │                 │              and new clusters)
                       ▼                 ▼
                adjudicate ◄──── status transitions                frontier, rare
                       │                 │
                       ▼                 ▼
                 render snapshot ─► current/ ─► consolidate        deterministic, then frontier
                       │
                       ▼
          briefing (satellite) · escalation (adopted belief negated)
```

Each stage reads artefacts, writes artefacts, and records a recipe (below). No
stage edits another stage's output.

| Stage         | Inputs                                                      | Outputs                                                   | Runs                 |
| ------------- | ----------------------------------------------------------- | --------------------------------------------------------- | -------------------- |
| `acquire`     | BibTeX entry                                                | PDF manifestation, `retrieval_log`, licence               | shipped              |
| `extract`     | PDF                                                         | extracted Markdown, versioned by extractor                | shipped, path change |
| `profile`     | Markdown, layout text                                       | sections, equations, figures, tables, quality per section | dossier slice 5      |
| `chunk`       | Markdown                                                    | chunk set, keyed by chunker version                       | shipped, key change  |
| `fts-index`   | active chunk set, units                                     | `chunks_fts`, `units_fts`                                 | shipped, extended    |
| `embed`       | chunk set or unit set, embedder                             | vectors keyed by (content hash, model, version)           | local                |
| `units`       | one section's Markdown plus the profile                     | one file per unit, a run index, the validated raw output  | local, `reader`      |
| `candidates`  | a paper's units or a belief; corpus indexes; `topics.yaml`  | candidate pairs with the source that proposed each        | deterministic        |
| `screen`      | candidate pairs                                             | kept pairs with a one-line reason; topic tags per unit    | local, `screener`    |
| `judge`       | one kept pair, or one belief and one unit                   | a verdict per family: relation file or ledger row         | local, two families  |
| `adjudicate`  | a `contradicts` both families reached; a pending negation   | an upheld or dismissed verdict                            | frontier, `judge`    |
| `propose`     | corroborating unit clusters; hand-reviewed briefings in git | proposed beliefs                                          | frontier, `writer`   |
| `render`      | the store, the snapshot policy, `beliefs.yaml`, decisions   | one snapshot of the whole corpus; the `current` pointer   | deterministic        |
| `consolidate` | the current units and beliefs of one topic                  | a topic page, every statement citing units                | frontier, `writer`   |
| `escalate`    | an adopted belief whose status became `negated`             | an escalation file and a decisions template               | deterministic        |

`units` and `judge` fan out per item with the per-provider concurrency from
config; `render` and `consolidate` reduce. The chain for one paper is a
`knowledge` job kind on the jobs loop ([indexing-jobs.md](indexing-jobs.md)),
with the same stage cursor and resume rules as a dossier. Belief checks are a
`belief-check` job kind.

## Directory layout and version key

### The recipe is the identity

Every artefact is produced by a recipe, and the artefact's identity is the hash
of the recipe. Nothing else names it.

```json
{
  "stage": "units",
  "schema": 2,
  "inputs": ["sha256:7c1e…", "sha256:a90f…"],
  "processor": "reader=ollama/qwen3:32b-q4_K_M@sha256:11d2…",
  "prompt": "sha256:3c9e1a…",
  "params": { "temperature": 0 }
}
```

- `inputs` are the content hashes of the input artefacts, sorted. A changed
  PDF, extractor, or chunker changes them, which is how upstream changes reach
  downstream identities without a dependency tracker.
- `processor` is the resolved model name the provider reported plus its digest
  where the provider gives one (Ollama does), or the deterministic processor
  and its version (`chunker@3`).
- `prompt` is the prompt-set hash from [model-providers.md](model-providers.md),
  absent for deterministic stages.
- `params` carries temperature and, for sampled runs, the seed.
- `schema` is the output schema version of the stage.
- `recipe_hash = sha256(canonical JSON)`. The `model_runs` row for the call
  stores the same `input_hash` and `prompt_hash`, so output reuse and artefact
  identity are one rule.

The on-disk name is a readable projection of the recipe, unique because it
carries hash prefixes, and `recipe.yaml` inside the directory carries the full
record:

```
<processor-slug>[.p<prompt7>].s<schema>.i<inputs7>
qwen3-32b-q4.p3c9e1a7.s2.i7c1e0b4
chunker-3.s1.ia90f2d1
```

Two directories with the same name are the same recipe, and a rerun of the
same recipe is a no-op. That makes resume free, and it also means repeating a
run teaches nothing: see [Repetition and evidence](#repetition-and-evidence).

### Store and current

**Every run lives in an immutable store; readers use one rendered view.**
File readers (grep, an agent, a person in a file browser) should not need the
precedence policy or the database to know which of five runs counts. The
store answers provenance and evaluation; `current/` answers "what does the
corpus hold".

```
<corpus>/
  references.bib                         git
  beliefs.yaml                           git: adopted beliefs, human-owned
  topics.yaml                            git: topic taxonomy and quantity tolerances
  knowledge.config.json                  git: roles, family rotation, snapshot policy, caps
  review/
    escalations/<id>.yaml                git: human verdicts on negated adopted beliefs
    gold/<item>.yaml                     git: the labelled gold set
    briefings/<id>.md                    git: hand-reviewed briefings, citing a snapshot hash
  papers/
    pdf/<stem>.pdf                       never git
    markdown/<stem>.md                   transition copy of the active extraction
  knowledge/                             never git
    store/                               immutable; every run, addressed by recipe
      source/<stem>/source.yaml          pdf sha256, DOI, key, access, licence, disclosure
      text/<stem>/<recipe>/paper.md
      units/<stem>/<recipe>/
        recipe.yaml                      full recipe, model_runs ids, timing, usage
        _index.md                        this run's units by kind, page, section
        u_<12hex>.md
        raw.json                         the validated output the files were rendered from
      relations/<stem>/<recipe>/r_<ida>_<idb>.md
      beliefs/<recipe>/b_<id>.md         machine-proposed beliefs
      belief-checks/<yyyy-mm>.jsonl      append-only mirror of the ledger table
      consolidation/<topic>/<recipe>/consolidation.md
    snapshots/
      manifests/<snapshot>.yaml          kept forever: policy hash and every store recipe read
      <snapshot>/                        rendered; the last eight are kept
        papers/<stem>/_index.md          the paper's current units, plus anchors only older runs found
        papers/<stem>/u_<12hex>.md       canonical unit, with pointers to alternatives
        beliefs/<id>.md                  definition, status, support, challenges, history
        beliefs/_register.md             every belief by status and topic
        topics/<topic>.md                consolidation, units, beliefs
        _changes.md                      what changed since the previous snapshot
    current -> snapshots/<snapshot>      the only mutable path in knowledge/
    escalations/<id>/escalation.md       what a human must decide, evidence inline
    eval/<run>/report.md
```

- **One symlink is the only mutable thing.** `render` writes a complete new
  snapshot directory, then replaces `current` with a new symlink through an
  atomic rename. Rolling back means pointing it at an older snapshot. This is
  the relationship git's `HEAD` has with its object store.
- **Snapshots are rendered files, not links into the store.** A canonical
  unit carries what no single run has: pointers to alternatives, disagreement
  flags, its belief memberships. A symlink to one run's file cannot hold
  those.
- **Pruning snapshots throws nothing away.** A snapshot is a deterministic
  render of its manifest, and the manifest and the store are never pruned. A
  briefing in git cites its snapshot hash, and `knowledge render --snapshot
<hash>` rebuilds any pruned one byte for byte.
- **Repeated checks are rows, not files.** A belief check that reaches the
  same verdict as last time appends a ledger row and its JSONL mirror. Markdown
  is rendered only into snapshots, so constant local runs do not fill the disk
  with identical verdict files.

Chunks and embeddings stay in SQLite as keyed, immutable rows. SQLite is also
the catalogue of everything in the store: the files are the source of truth,
the rows are the index, and `knowledge reindex` rebuilds the rows from front
matter and JSONL. That is the relationship manifestations already have with
files.

### Two changes to shipped code

**Chunks become immutable.** Today the indexer re-chunks everything on a
chunker version bump and overwrites. The chunk key becomes
`(manifestation_id, chunker_version, ordinal)`; a bump adds a chunk set, and
the FTS tables index the chunk set the config names as active. Old sets stay
until an explicit prune, the vector plan's rule applied one level up.

**Extraction output is versioned.** The extract stage writes to
`knowledge/store/text/<stem>/<recipe>/paper.md`, and the manifestation row
points there. `papers/markdown/<stem>.md` remains for one release as a copy of
the active extraction, so `read-content` and existing scripts keep working,
and goes away in the release after `markdown-locator` reads manifestations
only.

### Catalogue tables

`manifestations` is already an artefact table (kind, path, content hash,
producer name and version). It widens rather than gaining a sibling:

```sql
ALTER TABLE manifestations ADD COLUMN recipe_hash TEXT;
ALTER TABLE manifestations ADD COLUMN schema_version INTEGER;
ALTER TABLE manifestations ADD COLUMN prompt_hash TEXT;
ALTER TABLE manifestations ADD COLUMN model_run_id INTEGER REFERENCES model_runs(id);
-- kind CHECK gains: 'unit-set', 'relation-set', 'belief-set', 'consolidation'

CREATE TABLE artefact_inputs (
  artefact_id INTEGER NOT NULL REFERENCES manifestations(id) ON DELETE CASCADE,
  input_id    INTEGER NOT NULL REFERENCES manifestations(id),
  PRIMARY KEY (artefact_id, input_id)
);

CREATE TABLE units (            -- one row per unit file, for search and joins
  id TEXT NOT NULL,             -- u_<12hex>, the anchor
  set_id INTEGER NOT NULL REFERENCES manifestations(id) ON DELETE CASCADE,
  citation_id INTEGER NOT NULL REFERENCES citations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('claim','assumption','result','method','limitation')),
  page INTEGER, section_path TEXT, quote TEXT NOT NULL, statement TEXT NOT NULL,
  quote_check TEXT NOT NULL,    -- exact | close | not-found
  topics TEXT,                  -- JSON array from topics.yaml
  PRIMARY KEY (id, set_id)
);
CREATE VIRTUAL TABLE units_fts USING fts5(statement, quote, content='units', ...);

CREATE TABLE relations (
  id TEXT NOT NULL,             -- r_<ida>_<idb>
  set_id INTEGER NOT NULL REFERENCES manifestations(id) ON DELETE CASCADE,
  unit_a TEXT NOT NULL, unit_b TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('supports','contradicts','refines','out-of-scope','unclear')),
  differing_condition TEXT,     -- required when relation = refines
  family TEXT NOT NULL,
  PRIMARY KEY (id, set_id)
);

CREATE TABLE belief_checks (    -- append-only ledger
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  belief_id TEXT NOT NULL,
  belief_hash TEXT NOT NULL,    -- hash of the belief's definition when checked
  unit_id TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('supports','contradicts','refines','irrelevant')),
  family TEXT NOT NULL,
  evidence TEXT NOT NULL CHECK (evidence IN ('independent','stability','frontier')),
  recipe_hash TEXT NOT NULL,
  model_run_id INTEGER REFERENCES model_runs(id),
  checked_at TEXT NOT NULL
);
CREATE TRIGGER belief_checks_no_update BEFORE UPDATE ON belief_checks
  BEGIN SELECT RAISE(ABORT, 'belief_checks is append-only'); END;
CREATE TRIGGER belief_checks_no_delete BEFORE DELETE ON belief_checks
  BEGIN SELECT RAISE(ABORT, 'belief_checks is append-only'); END;

CREATE TABLE snapshots (
  hash TEXT PRIMARY KEY,
  policy_hash TEXT NOT NULL,
  manifest_path TEXT NOT NULL,
  rendered INTEGER NOT NULL,    -- 0 once pruned; the manifest remains
  created_at TEXT NOT NULL
);
```

`model_runs.dossier_id` becomes nullable; a run belongs to whatever artefact
references it. Keys, as ever, never enter any of these tables.

## The knowledge unit

One file per unit, YAML front matter rendered by code from the validated model
output, Markdown body in the authors' terms:

```markdown
---
id: u_8f1d2c3a9b0e
kind: result
paper:
  stem: Zhao2019
  bibtex_key: zhao2019roadside
  doi: 10.1016/j.trc.2019.01.007
  pdf_sha256: 3f2a9c…e81d
source:
  page: 7
  section: ['4 Results', '4.2 Vehicle speed']
  quote: >-
    The 85th percentile speed of passenger vehicles at the study site was
    52.3 km/h, 7.3 km/h above the posted limit.
  quote_check: exact
statement: >-
  The authors report an 85th percentile passenger-vehicle speed of 52.3 km/h
  at the study site, 7.3 km/h above the posted limit.
topics: [speed-percentiles]
quantities:
  - name: v85
    value: 52.3
    unit: km/h
    condition: 'passenger vehicles, posted limit 45 km/h'
scope:
  sensor: ['Velodyne VLP-16']
  setting: 'urban arterial, one intersection, three weekdays'
  population: 'passenger vehicles, n = 1204'
  method_units: [u_41c0aa2e77d1]
provenance:
  stage: units
  recipe: sha256:9b7e…
  model: ollama/qwen3:32b-q4_K_M
  prompt_hash: sha256:3c9e1a…
  schema_version: 2
  run_at: 2026-10-20T03:12:44Z
---

## Statement

The authors report an 85th percentile passenger-vehicle speed of 52.3 km/h at
the study site, 7.3 km/h above the posted limit.

## Conditions, as the authors state them

Speeds were measured by a single VLP-16 over three weekdays at one urban
arterial intersection; the sample is 1,204 passenger vehicles after
classification.

## Flags

None.
```

The rendered copy in a snapshot adds `alternatives` (other runs that found
this anchor, with their recipes), `found_by` (model families), and `beliefs`
(the beliefs this unit supports or challenges).

**The id is the anchor.**
`id = sha256(pdf_sha256 + kind + normalizeForMatch(quote))` truncated to twelve
hex characters. Two models that extract the same quote as the same kind
produce the same unit; the quote is the evidence, so the evidence is the
identity. Quotes from different runs that overlap at or above the 0.8 token
threshold `verify-quote` already uses for a close match render as one unit.

**Why this size.** A unit is one assertion anchored to one quote, with the
conditions under which it holds.

- Smaller (a bare number, a sentence without conditions) cannot be compared
  across papers: 52.3 km/h means nothing without the sensor, the site, and the
  population, and most false contradictions come from comparing results whose
  conditions differ.
- Larger (a section digest, a paper summary) cannot be refused by a gate.
  `verify-quote` can refuse one quote; it cannot refuse a paragraph that blends
  four findings, and no check can say which of the four a belief rests on.
- The dossier's Claims, Stated limitations, and Glossary parts
  ([dossier.md](dossier.md#anatomy)) are already "assertion plus verbatim
  support plus section path". Units are that structure with kind, scope, and
  quantities added, so the dossier `read` stage produces units and the dossier
  composes from them. One definition of a claim, two consumers.

**Gates on every unit.** The quote gate (`verify-quote` against the paper's own
chunks), the number gate (every value in `quantities` and `statement` appears
in the quote or the section), the schema (zod), and a coverage gate: every
profiled section and table yields at least one unit or an explicit `none`
record with a reason, so an empty section is a visible gap rather than
silence. A unit that fails stays in its run marked ⚑, counts in the run index,
and is never a candidate and never evidence for a belief.

Kinds are the five the corpus needs: `claim` (what the authors assert they
showed), `assumption` (what they take as given, including modelling choices),
`result` (a measured or computed finding with quantities), `method` (how they
measured or computed), `limitation` (what they say does not hold). A `result`
names the `method` units it depends on in the same paper, which is what lets a
comparison say "measured differently" with evidence.

## Beliefs

**A unit records what a paper says. A belief records what the group holds,
and is only as strong as the units that currently support it.**

```yaml
id: b_ttc_critical
kind: threshold # assumption | ground-truth | threshold | definition
statement: >-
  A time to collision below 1.5 s marks a serious conflict at signalised
  intersections.
topics: [time-to-collision]
scope: { setting: signalised intersection, road_users: vehicle-vehicle }
quantities: [{ name: ttc_critical, value: 1.5, unit: s, tolerance: 0.3 }]
origin:
  units: [u_8f1d2c3a9b0e, u_41c0aa2e77d1]
  report: review/briefings/<id>.md
adopted: true
```

| Kind           | What it is                                   | Checked by                                                       |
| -------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| `ground-truth` | an empirical finding with quantities         | quantities in candidate units, within the stated tolerance       |
| `threshold`    | a cut-off the group uses to classify         | stated thresholds and the evidence for them in candidate units   |
| `assumption`   | a modelling choice the group's work rests on | units that state a contrary assumption or show sensitivity to it |
| `definition`   | how the group measures a quantity            | units defining the same quantity differently, with scope         |

**Two sources, one shape.** Adopted beliefs live in `beliefs.yaml` in git,
written and owned by the group. Machine-proposed beliefs live in the store,
in the same shape with `adopted: false`. Both are checked by the same loop and
rendered in the same register; only adopted beliefs can escalate.

- **Bootstrap.** The `propose` stage reads clusters of units that two local
  families agree support one statement, and the hand-reviewed briefings in
  git, which are the truest record of what the group has relied on. Each
  proposal names its origin units and briefing passages. The group reads the
  register once and adopts what it relies on: `knowledge adopt <id>` copies a
  proposal into `beliefs.yaml`.
- **Growth.** After bootstrap, `propose` runs when a topic gains a cluster of
  agreeing units no belief covers. Proposals land in the register; nothing
  asks the group to act on them.
- **Edits.** Changing a belief in `beliefs.yaml` changes its definition hash.
  Old ledger rows stay under the old hash, status is computed from rows under
  the current hash only, and a full re-check is queued.
- **Tolerances live with quantities.** A `ground-truth` or `threshold` belief
  carries the tolerance that decides when a different number is a challenge,
  and `topics.yaml` carries default tolerances per quantity name (`v85`,
  `ttc`, `headway`). The group owns the tolerance, so a model never decides
  how different is different enough.

### Status

**Status is computed by code from the ledger, never stated by a model.**

| Status         | Rule                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `proposed`     | supported by fewer than two papers, or judged by one model family only                           |
| `corroborated` | two or more papers support it, each judged `supports` by two or more families, no open challenge |
| `contested`    | a scope-compatible unit judged `contradicts` by two or more local families, not yet adjudicated  |
| `negated`      | a frontier adjudicator upholds a challenge, and the difference exceeds the tolerance             |
| `stale`        | its topic gained three or more papers since its last full check; shown beside the status above   |

- A challenge is scope-compatible only when every scope axis both sides state
  agrees. Otherwise the most it can be is `refines`, which is recorded and
  shown but never moves the status. Most apparent conflicts in this
  literature are a VLP-16 at one site against a 64-beam sensor at another.
- A unit flagged by any gate is never counted, for or against.
- A dismissed challenge stays in the ledger with the adjudication and is not
  re-adjudicated unless its unit changes.
- **Papers are not votes.** One upheld, scope-compatible challenge beyond
  tolerance negates a belief however many papers support it. The register
  shows the support count beside the challenge so a reader sees the balance;
  the status does not average it away.

### When a human acts

The group acts in three places, and two of them happen once:

1. **Bootstrap**: read the proposed register and adopt what the group relies
   on.
2. **Gold set**: label about 100 items once (units, relations, belief checks)
   for the eval. Agreement between model families cannot catch blind spots
   they share; a fixed human-labelled set is the only defence against that.
3. **Escalation**: an adopted belief became `negated`. The escalation shows
   the belief, the upheld challenge with its quote, both local verdicts and
   the frontier reasoning, and the supporting units. The decisions template
   offers `keep` (the challenge does not apply; recorded with a reason),
   `revise` (edit `beliefs.yaml`), or `unadopt`.

Everything else, including `contested` adopted beliefs, new proposals, and
every status change of an unadopted belief, appears in `_changes.md` and the
weekly briefing as information. Local models alone never page anyone.

## The autonomous loop

**Cron fires `citation-needed knowledge tick` hourly. The tick enqueues work
in priority order and exits; the worker under `serve` drains the queue.** The
core holds no clock: the tick is a work generator, and the schedule is the
user's cron entry.

| Priority | Work                                                                                                              | Model class                            |
| -------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1        | **New papers.** `references.bib` hash changed: acquire, extract, units, compare, check every belief in its topics | local, then frontier on contradictions |
| 2        | **Adjudication.** Contradictions two families agree on; contested adopted beliefs                                 | frontier, under the monthly cap        |
| 3        | **Stale beliefs.** A full re-check of beliefs whose topics grew                                                   | local                                  |
| 4        | **Thin evidence.** Beliefs and relations judged by one family get the next family in the rotation                 | local                                  |
| 5        | **Expansion.** Papers extracted by one family only get the next family's extraction                               | local                                  |
| 6        | **Render.** A new snapshot whenever the store or `beliefs.yaml` changed since the last one                        | deterministic                          |

- Priorities 3 to 5 run only while the local queue is otherwise empty, so
  maintenance never delays a new paper.
- Priority 2 pauses at the monthly frontier cap. Contested beliefs wait in
  `contested`, which is the honest state, and the briefing says so.
- Every job is idempotent by recipe, so a tick that enqueues work already done
  costs nothing.
- `knowledge status` prints the queue, the cap, and when each family last ran.

### Repetition and evidence

**Running the same recipe again teaches nothing, and the store makes that
explicit by returning the cached result.** A repeated check counts as evidence
only when something independent changed, and the ledger records which kind:

| `evidence`    | Produced by                              | Counts toward                                      |
| ------------- | ---------------------------------------- | -------------------------------------------------- |
| `independent` | a different model family, or a new paper | the two-family and two-paper rules                 |
| `stability`   | the same model with a different seed     | a stability score shown in the register, no status |
| `frontier`    | an adjudication                          | `negated`, or dismissing a challenge               |

Stability is still worth measuring: a belief whose local verdict flips across
seeds is one the briefing should not lean on. It is not independence, because
one model agreeing with itself is not evidence
([TENETS.md](../../TENETS.md#7-independent-models-not-one-oracle)).

## Comparing a new paper with the corpus

### Candidates before judgement

A new paper's units are compared only with units a deterministic pass
proposes, never all-against-all. The same pass proposes units for a belief
check, with the belief's statement and quantities as the query.

1. **Same topic.** `topics.yaml` is a human-owned closed list (headway,
   time-to-collision, speed-percentiles, crash-exposure, detection-accuracy,
   tracking, sensor-placement, calibration, …). The screener assigns each unit
   one or more topics from the list or `none`; `none` units appear in the
   summary as novelty, not as candidates.
2. **Lexical and semantic neighbours.** `units_fts` over statement and quote,
   and kNN over unit embeddings, each returning the top 20 from other papers,
   fused by reciprocal rank as in
   [vector-hybrid-search.md](vector-hybrid-search.md).
3. **Kind compatibility.** `result` with `result` or `claim`; `claim` with
   `claim`; `method` with `method`; `assumption` with `result`; `limitation`
   with `claim` or `result`. Nothing else is a pair.

The screener then keeps or drops each pair with a one-line reason. A dropped
pair is recorded, so it is never proposed again for the same two anchors.
About 500 raw pairs per new paper become about 50 judged ones.

### What the relations mean

Each local family sees both quotes, kinds, scopes, and quantities, and chooses
one relation with a reason in the units' own terms:

| Relation       | Holds when                                                                                                                                | Precondition the code enforces                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `supports`     | same question, findings compatible, conditions compatible on every scope axis both state                                                  | kinds compatible                                                         |
| `contradicts`  | same question, conditions compatible, findings incompatible: quantities apart by more than the tolerance, opposite direction, or a denial | both units carry a `result` or `claim`; no scope axis both state differs |
| `refines`      | same question, findings differ because a named condition differs, or one bounds or narrows the other                                      | `differing_condition` is named; the verdict is refused without it        |
| `out-of-scope` | different question; recorded so the pair is not re-proposed                                                                               | none                                                                     |
| `unclear`      | the quotes do not settle it                                                                                                               | always allowed; a high rate is an extraction problem                     |

A relation stands when two families agree on it. When they disagree, the
relation renders as `disputed` with both verdicts, and the next family in the
rotation is queued. A `contradicts` both families agree on goes to frontier
adjudication; upheld, it renders as `contradicts (adjudicated)`, and any
belief resting on the other unit is re-checked.

### What the briefing gets

`current/_changes.md` is written for the weekly agent: new papers and their
units by kind, relations by type and topic, belief status changes with the
evidence behind each, new proposals, units with no topic (novelty), and the
unit ids behind every count. The briefing may rank a new source by how much
it touches what the corpus holds and which beliefs it moved. It gets no
quality score, because the harness does not judge papers
([TENETS.md](../../TENETS.md#2-report-dont-review)).

## Snapshot policy

**Every run is kept in the store; `render` selects one version per paper by a
policy in `knowledge.config.json`, and the policy's hash is part of the
snapshot's identity.** Consensus over prose is rejected: merged text has no
author and no quote. The policy decides six things:

1. **Preference is per paper, from one global list.** An ordered list of model
   and prompt pairs; for each paper the first pair with an eligible run wins.
   Choosing per kind (one model for results, another for assumptions) waits
   until the eval shows a real gap by kind.
2. **A better model has to earn eligibility.** A run is eligible only if it
   covered every profiled section and passed the quote gate at or above a
   threshold (90 percent by default). A stronger model that misquoted a third
   of its units falls back to the next entry rather than replacing a clean
   run.
3. **A mixed snapshot is normal during migration.** While a new model
   backfills, current shows it for some papers and the previous model for the
   rest. Each paper's index names its model, and the manifest counts papers
   per model.
4. **Evidence for adopted beliefs is pinned.** When an adopted belief cites a
   unit the newly preferred run did not extract, the snapshot carries that
   unit forward from its run, flagged `not in preferred run`, and queues a
   re-check of the belief. A model upgrade never silently removes the support
   under a belief the group relies on.
5. **Anchors only older runs found stay visible.** The paper's index lists
   them with links into the store, so a drop in recall is visible rather than
   silent, and the eval decides whether they were signal or noise.
6. **Humans outrank models.** A `keep`, `revise`, or `unadopt` decision
   overrides any model output in current. New papers and new ledger rows
   re-render under the existing policy automatically; changing the policy is a
   commit that cites an eval report.

The order of precedence when rendering:

```text
human decision  >  pinned evidence for adopted beliefs  >  first eligible run in the list  >  next run
```

Where runs disagree on a unit's `quantities`, `scope`, or `kind`, the
canonical unit is marked ⚑ `versions-disagree` with both values, and it is not
counted as belief evidence until a further family breaks the tie. Agreement
between two families on a quantity is recorded, because that is the one place
two independent models agreeing is evidence.

## Introducing a new model, embedding model, or stage

**Nothing is invalidated, because nothing is overwritten. What changes is
which version the policy selects, and only after the eval says it should.**

| Change                   | What happens                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| new local model family   | joins the rotation; the loop's priorities 4 and 5 give it work as idle time allows. It enters the snapshot preference list only by a config commit citing the eval                                                  |
| new prompt version       | same as a new model; the prompt-set hash is in the recipe. Deterministic stages downstream recompute lazily because their input hashes changed                                                                      |
| new schema version       | a deterministic migrator (`units@s2→s3`) is a stage with its own recipe; old files stay, migrated files sit beside them                                                                                             |
| new embedding model      | a new `(model, version)` namespace in the embeddings table; candidates use the namespace config names. Candidate recall on the gold set decides the switch; the old namespace is pruned explicitly, never on switch |
| new frontier judge       | adjudicates new transitions only. Past adjudications stand; re-adjudicating the gold set measures it                                                                                                                |
| new stage                | a new directory under `store/` and a new kind in the catalogue; it consumes existing artefacts by hash and invalidates nothing                                                                                      |
| new extractor or chunker | new text and chunk sets; units re-extract lazily. A unit whose quote still verifies against the new text keeps its anchor, so relations and belief evidence survive extractor upgrades                              |

**Lazy migration order.** Explicit backfills process papers in order of how
many adopted beliefs cite them, so the evidence the group relies on is
re-grounded first and the long tail waits for idle time.

**Showing the new version is better.** The eval harness under `eval/` (shared
with the dossier and claim-grounding evals, outside Jest) reports, per model
and prompt, against the gold set:

- unit recall (anchor match) and quote-gate pass rate
- candidate recall at 20, for embeddings
- relation and belief-check agreement with the gold labels, and the false
  contradiction rate
- agreement with the other families on the whole corpus, as a cheap proxy
  that runs every week
- tokens and wall-clock time per paper

A model is promoted by a commit to `knowledge.config.json` whose message cites
the eval report. That is the only way the preferred version changes, and git
carries the history of it.

## First version and the next two steps

### Version one: units and the current view

The `units` stage on the existing 160 papers with one local model: recipe
hashing and the widened catalogue, the chunk-key and extraction-path changes,
unit files with gates, the store layout, `render` writing the first snapshot
and the `current` symlink, `units_fts`, and two MCP tools (`search-units`,
`read-unit`) over a `KnowledgeService`. With one model the snapshot is a
straight render of one run, but the paths every reader learns are final from
the first day.

This answers (a), (b), and the extraction half of (d): the weekly agent
searches assertions with page and quote instead of chunks. It also produces
the measurement that picks the `reader`: quote-gate pass rate per local
model. No frontier call is made.

Exit criterion: 100 units across 10 papers checked by hand, which also seeds
the gold set, with the false-anchor rate (quote found, but the unit
misrepresents it) recorded. Above ten percent, fix the prompt or the model
before step two.

### Step two: beliefs and the loop

`knowledge tick` and the priority queue, the second local family, unit
embeddings, `topics.yaml`, `candidates`, `screen`, two-family `judge`,
`belief_checks` with status rules, `propose` and `knowledge adopt` for the
bootstrap, frontier `adjudicate` under a monthly cap, escalations, and
`_changes.md`. The weekly briefing switches to reading `current/`. MCP gains
`get-beliefs`, `get-relations`, and `compare-paper`.

### Step three: policy, consolidation, and measurement

The full snapshot policy (eligibility, pinning, mixed snapshots), the eval
harness over the completed gold set, topic consolidation pages, the lazy
backfill command, snapshot pruning, and register and topic views in the web
UI once the dossier pages exist.

### Cost at the assumed scale

Token figures are estimates to be replaced by `model_runs` totals after the
first month.

| Work                                          | Where    | Order of magnitude          |
| --------------------------------------------- | -------- | --------------------------- |
| units, one paper, one family                  | local    | 25k in, 5k out; minutes     |
| screen and judge, one new paper, two families | local    | about 1M in; under an hour  |
| belief re-checks, whole register, one family  | local    | a few million; overnight    |
| adjudication, one new paper                   | frontier | 5 contradictions, about 15k |
| proposals, bootstrap, once                    | frontier | about 2M                    |
| consolidation, one topic touched              | frontier | 20k in, 3k out              |
| **per new paper, steady state**               | frontier | **about 40k**               |

At five new papers a week, steady-state frontier use is under a million
tokens a month, well inside the assumed budget. The bootstrap is the largest
single item, and it runs once.

## Failure modes and refusals

### The three ways this fails

1. **Correlated local models corroborate a misreading.** Local models share
   training data, and two of them can agree that a quote says what it does
   not. A belief then reads `corroborated` on false evidence, and nobody is
   asked. Guards: the quote gate is deterministic, so a misquoted unit never
   counts; families must come from different vendors; every move to `negated`
   and every dismissed challenge goes through a frontier model; the gold set
   measures shared blind spots directly, and a falling gold-set score pauses
   promotions.
2. **Anchoring makes the corpus look covered when it is not.** A unit exists
   only where a model could quote. Results in tables, figures, or spread
   across two sentences are under-extracted, and a clean index hides it. A
   belief can sit at `proposed` for lack of evidence the papers do contain.
   Guards: the coverage gate requires a unit or a reasoned `none` per section
   and table; anchors only older runs found stay visible; tables and figures
   come through [visual-extraction.md](visual-extraction.md) when it lands.
3. **Status churn makes the register unreadable.** A belief near its
   tolerance flips between `corroborated` and `contested` as families
   disagree, the briefing reports it every week, and the group stops reading
   `_changes.md`. Guards: the scope precondition makes `refines` the default
   for differing conditions; tolerances are the group's, not a model's;
   `stability` is reported beside the status; `_changes.md` reports a belief
   that changed status more than twice in a month once, as unstable, rather
   than every time.

### What this plan refuses to build

- **A quality rating for papers.** The briefing ranks sources by overlap,
  novelty, and beliefs moved. A score for how good a paper is would be
  review, and the harness reports.
- **A machine path to `adopted`.** Models may move a belief to `corroborated`
  or `negated`; only a commit to `beliefs.yaml` adopts one. A belief the group
  relies on is always a belief someone chose.
- **Negation by majority.** Papers are not votes. Status follows the rules
  above, and the support count is shown, never netted against challenges.
- **Editing in place.** There is no "fix this unit" operation. A correction is
  a decision or a new version from a new recipe, and the old file stays.
- **A global switch to send restricted sources to remote models.** Disclosure
  is per paper, as it is per dossier.
- **Cross-paper synthesis from model knowledge.** Proposals and topic pages
  cite unit ids or fail the gate.
- **A clock in the core.** Cron fires the tick; the tick holds no schedule.

## Rejected alternatives

- **Segmenting versions by filename only.** Every file reader (grep, an
  agent, a person) sees every run and has to know the precedence policy to
  pick one.
- **A current view in SQLite only.** The MCP tools could query it, but the
  briefing agent and people read Markdown, and a file reader should not need
  the database to know which file counts.
- **Per-file symlinks from current into the store.** A canonical unit carries
  alternatives, flags, and belief memberships that no single run's file has.
  One symlink to a rendered snapshot keeps the swap atomic and the files
  complete.
- **A mutable current tree edited in place.** A half-written render would be
  what the briefing reads. Writing a new snapshot and swapping one link never
  exposes a partial state.
- **Human confirmation of every relation and statement.** It does not survive
  a weekly cadence, and a reviewer who confirms everything confirms nothing.
  Humans act on negated adopted beliefs and label the gold set once.
- **All-pairs judgement with a frontier model.** Four thousand units squared
  is beyond any budget and mostly `out-of-scope`. Candidates, a screener, and
  local families spend frontier tokens only where a state changes.
- **Consensus prose across models.** Merged text has no author and no quote.
  Agreement is recorded as evidence on quantities; text is selected, never
  blended.
- **Model-discovered topics.** Clusters drift between runs and nobody owns
  them. A human-owned taxonomy is the scope of the beliefs; `none` surfaces
  what it misses.
- **A separate knowledge database or vector store.** The catalogue is rows
  over files in the SQLite the project already has, and brute-force cosine
  over 4,000 unit vectors is instant.
- **A web UI as the first surface.** The consumers are an agent and cron. MCP
  and the CLI bind first; register and topic views join the web UI once the
  dossier pages exist.

## Backlog items (parked; merge into BACKLOG.md if this plan is adopted)

Version one:

- [db] M - Immutable chunk sets: key (manifestation_id, chunker_version, ordinal); FTS indexes the active set; explicit prune (see docs/plans/corpus-knowledge.md)
- [flow] M - Versioned extraction output under knowledge/store/text/<stem>/<recipe>/; papers/markdown copy for one release (see docs/plans/corpus-knowledge.md)
- [db] M - Catalogue: manifestations gains recipe_hash, schema_version, prompt_hash, model_run_id and new kinds; artefact_inputs; units and units_fts (see docs/plans/corpus-knowledge.md)
- [util] S - Recipe hashing and directory naming; recipe.yaml writer and reader (see docs/plans/corpus-knowledge.md)
- [model] L - units stage: reader role per section, zod schema, anchor ids, quote/number/coverage gates, unit files, \_index.md, raw.json (see docs/plans/corpus-knowledge.md)
- [flow] M - render stage: snapshot directory, manifest, atomic current symlink swap, snapshots table (see docs/plans/corpus-knowledge.md)
- [cli] S - `knowledge run --stage <stage> [--paper] [--all]`, `knowledge render`, and `knowledge reindex` (see docs/plans/corpus-knowledge.md)
- [mcp] S - search-units and read-unit over KnowledgeService, reading current (see docs/plans/corpus-knowledge.md)
- [verify] S - Version-one exit check: 100 hand-checked units seeding the gold set; false-anchor rate (see docs/plans/corpus-knowledge.md)

Step two:

- [flow] M - `knowledge tick`: references.bib change detection, priority queue, idle-only maintenance, monthly frontier cap; `knowledge status` (see docs/plans/corpus-knowledge.md)
- [cfg] S - Local family rotation and the screener and judge roles in config (see docs/plans/corpus-knowledge.md and docs/plans/model-providers.md)
- [search] M - Unit embeddings: embedder role, embeddings namespace, brute-force kNN (adopts vector-hybrid-search phase 1 for units; see docs/plans/corpus-knowledge.md)
- [cfg] S - topics.yaml taxonomy with default quantity tolerances; screener topic assignment (see docs/plans/corpus-knowledge.md)
- [flow] M - candidates and screen stages: topic, FTS and kNN fusion, kind compatibility; dropped pairs recorded (see docs/plans/corpus-knowledge.md)
- [model] L - judge stage with two local families: relations with preconditions, disputed handling (see docs/plans/corpus-knowledge.md)
- [db] M - beliefs.yaml loader, belief_checks append-only ledger with triggers, JSONL mirror, status rules (see docs/plans/corpus-knowledge.md)
- [model] M - propose stage and `knowledge adopt`: bootstrap from agreeing clusters and briefings in git (see docs/plans/corpus-knowledge.md)
- [model] M - adjudicate stage: frontier verdict on agreed contradictions and contested adopted beliefs (see docs/plans/corpus-knowledge.md)
- [flow] S - Escalation renderer and decisions template; `knowledge ingest-decisions` (see docs/plans/corpus-knowledge.md)
- [flow] S - \_changes.md renderer for the briefing agent (see docs/plans/corpus-knowledge.md)
- [mcp] S - get-beliefs, get-relations, and compare-paper (see docs/plans/corpus-knowledge.md)

Step three:

- [flow] M - Snapshot policy: preference list, eligibility, pinning, versions-disagree flags, older-run anchors in the index (see docs/plans/corpus-knowledge.md)
- [verify] L - Knowledge eval under eval/ over the gold set: unit recall, candidate recall, relation and belief-check agreement, false contradiction rate, cross-family agreement (see docs/plans/corpus-knowledge.md)
- [verify] M - Complete the gold set to about 100 labelled items across units, relations, and belief checks (see docs/plans/corpus-knowledge.md)
- [model] L - consolidate stage per topic with unit-citation gate (see docs/plans/corpus-knowledge.md)
- [flow] S - Lazy backfill ordered by adopted-belief citations; snapshot pruning keeping manifests (see docs/plans/corpus-knowledge.md)
- [ui] M - Belief register and topic views in the web UI (see docs/plans/corpus-knowledge.md and docs/plans/web-ui.md)

## Testing

- Recipe identity: the same inputs, model, prompt, schema, and seed produce
  the same directory name and a no-op rerun; any one change produces a new one
  beside it, and the old directory is byte-identical afterwards.
- Immutability: a full run, tick, and render leave every pre-existing file in
  `store/` byte-identical; an update or delete on `belief_checks` aborts.
- Snapshots: a render writes a complete directory before the symlink swaps; a
  pruned snapshot rebuilt from its manifest is byte-identical to the original.
- Anchors: two scripted extractions with the same quote yield one unit id;
  quotes overlapping at 0.8 render as one unit; below it they do not.
- Gates: a unit whose quote is not in the source is marked ⚑ and is never a
  candidate or belief evidence; a quantity absent from the section fails the
  number gate; a section with no unit and no `none` record fails coverage.
- Preconditions: a pair with differing stated sensors cannot be
  `contradicts`; a `refines` without `differing_condition` is refused.
- Status rules: one family's `supports` leaves a belief `proposed`; two
  families over two papers make it `corroborated`; a `stability` row never
  changes status; one upheld challenge beyond tolerance negates a belief with
  ten supporting papers; a challenge within tolerance does not.
- Escalation routing: a negated adopted belief escalates; a negated unadopted
  belief and a contested adopted belief do not.
- Pinning: switching the preferred model drops an anchor; the snapshot keeps
  it, flagged, for an adopted belief that cites it, and omits it otherwise.
- Belief edits: editing a belief's definition keeps old rows, computes status
  from the new hash only, and queues a re-check.
- Tick: a tick with nothing new enqueues nothing; a changed `references.bib`
  enqueues the new paper ahead of maintenance; frontier work pauses at the
  monthly cap.
- Disclosure: a non-open-access paper with a remote judge pauses before the
  first remote call; local roles proceed.
- Model calls are scripted fixtures in Jest; quality is measured in `eval/`.

## Open questions

1. Should `assumption` beliefs require a frontier check on every new paper in
   their topic, rather than only on transitions? They matter most for
   crash-exposure modelling, and they are the kind local models judge worst.
2. Many results state no confidence interval. The plan uses per-quantity
   tolerances owned by the group; should a stated interval, where one exists,
   override the tolerance?
3. Should a belief's status appear in the dossier of a paper that supports or
   challenges it? It would be the first dossier content not drawn from the
   source, so the default is no.

## Relationship to other plans

- [dossier.md](dossier.md): the `reader` role and its gates produce units;
  the dossier's claim, limitation, and glossary parts are rendered from them.
- [model-providers.md](model-providers.md): roles (`judge` and `screener`
  added), `model_runs`, prompt-set hashes, disclosure, spend caps.
- [indexing-jobs.md](indexing-jobs.md): the `knowledge` and `belief-check`
  job kinds, the worker that drains the tick's queue.
- [vector-hybrid-search.md](vector-hybrid-search.md): the embeddings table and
  reciprocal-rank fusion, adopted here for unit candidates and otherwise still
  deferred for chunk search.
- [fts5-full-text-search.md](fts5-full-text-search.md): `verify-quote` is the
  quote gate; `units_fts` follows the external-content pattern.
- [domain-model.md](domain-model.md): manifestations as the catalogue; content
  hashes as recipe inputs.
- [claim-grounding-eval.md](claim-grounding-eval.md): the shared eval runner,
  replay cache, and cost guard.
- [visual-extraction.md](visual-extraction.md): tables and figures as unit
  sources once it lands.
- [web-ui.md](web-ui.md): register and topic views, after the dossier pages.
