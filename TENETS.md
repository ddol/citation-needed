```
   ████████╗███████╗███╗   ██╗███████╗████████╗███████╗
   ╚══██╔══╝██╔════╝████╗  ██║██╔════╝╚══██╔══╝██╔════╝
      ██║   █████╗  ██╔██╗ ██║█████╗     ██║   ███████╗
      ██║   ██╔══╝  ██║╚██╗██║██╔══╝     ██║   ╚════██║
      ██║   ███████╗██║ ╚████║███████╗   ██║   ███████║
      ╚═╝   ╚══════╝╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚══════╝
             the principles behind the product
```

# Tenets

These are the durable commitments. They outrank convenience, throughput, and
feature count. [DESIGN.md](DESIGN.md) turns them into concrete rules;
[docs/plans/](docs/plans/README.md) holds the designs that follow from them.

---

## 1. The dossier is the product

Everything here exists to turn one source into a **dossier** a researcher can
rely on: what the source claims, how it argues, its mathematics reproduced, its
diagrams described, its tables intact, and nothing it does not say.

Retrieval, extraction, indexing, and verification are means. A feature earns
its place by making dossiers more faithful, more complete, or cheaper to
produce, not by making the corpus bigger.

The failure this guards against is a digest that reads well and is wrong: a
plausible summary, an equation with a dropped subscript, a figure described as
showing what the authors hoped. A tool that produces that faster is worse than
no tool.

## 2. Report, don't review

A dossier says what the source says, in the source's terms, attributed to its
authors. It does not praise, rank, critique, or fill gaps from a model's
general knowledge. Numbers, equations, captions, and quoted claims are
reproduced, never paraphrased into new values. Where the source is ambiguous,
the dossier says so.

Judgement is the reader's job. A dossier that has opinions is one more source
to check, not a map of the one it digests.

## 3. A wrong answer is worse than no answer

A missing equation is a visible gap. Someone notices it and reads the page.

A wrong equation, cleanly typeset, is silent corruption. So is a wrong PDF
filed under the right name: every stage downstream faithfully processes the
wrong paper and reports success.

So the asymmetry is deliberate: **when a stage cannot produce something
faithfully, it marks the gap and says why.** When identity is uncertain, the
pipeline refuses to start. A flag a researcher can act on beats a line they
will trust by mistake. Completeness is never a reason to relax this.

## 4. Relevance is not identity

A search result is a candidate. Nothing more.

Ranking answers "what is most related to these words", which is not the
question we asked. An upstream API returning a confident first result is not
evidence; it is a suggestion.

An artifact is what it claims to be only once we have checked it against the
identity we asked for: matching title, matching DOI, matching hash. Verify,
then trust.

## 5. Legitimate access, deliberate disclosure

We take the open route first, then the user's own front door. We never pick a
lock.

- Open access first: Unpaywall, Semantic Scholar, arXiv.
- Then the user's own entitlements: their institutional proxy, their
  credentials, at their instruction.
- We identify ourselves on every request (`User-Agent` with a contact address)
  and rate-limit every host.
- We do not scrape, circumvent, or crawl on our own initiative.

The same care runs outward. Source text goes only to the model providers the
user configured, with the user's own keys, and the user can see which roles
send it off the machine. A paywalled source reaches a remote model only when the
user confirms it for that dossier, because publisher licences often forbid it.
A fully local setup is always possible.

This is a tenet rather than a policy because it constrains what we build, not
just how we behave.

## 6. Models write, checks decide

Language models do the reading, transcribing, describing, and writing; nothing
else can comprehend a paper. They do not get the last word.

Every dossier passes deterministic checks against the source: quotations found
in its text, numbers present in it, equations that parse and match the page,
every section, equation, figure, and table covered. Checks flag; they never
silently rewrite.

The evidence layer (retrieval, extraction, search, quote verification, the
provenance record) stays deterministic and inspectable. Given the same source,
it gives the same answer, and a human can follow why.

## 7. Independent models, not one oracle

Each job goes to a model suited to it: vision models for equations and
diagrams, long-context models for reading, a model from a different family to
audit. Two independent models agreeing on a transcription is evidence. One
model agreeing with itself is not.

When independence is not available, the dossier still runs and says so.

## 8. Every stage is honest

A stage that cannot succeed is not in the pipeline.

Capability that exists in code but cannot yet do its job is **parked**
(unexported, unwired, still covered by its tests) rather than run on every
attempt to append noise to a failure message. A stage rejoins when it can do
its job.

The same applies to reporting: a count of "verified" that includes items that
were not verified is a lie told to the only person who could catch the
problem.

## 9. Provenance or it didn't happen

Every artifact traces back: `retrieval_log` for what was fetched and from
where, `manifestations` for what is on disk, content hashes for what it is,
section paths for where a passage came from, `model_runs` for which model wrote
which line, when, and from what input.

Every dossier ends with a standardized footer naming its source, the models
that compiled it, and when the source was extracted and the dossier
synthesized. Code renders the footer from those records. A model never writes
its own provenance.

## 10. One definition, thin adapters

Each concept is defined once and reached through thin adapters: one service
layer, with the web UI, MCP, and the CLI as gateways rather than parallel
implementations. Two mechanisms maintained side by side is a smell that needs a
justification and an end date.
