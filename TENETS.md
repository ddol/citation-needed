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

## 1. The question is the product

Everything here exists to answer one question about a citation:

> **Is this a real quote, and is it a fair interpretation of the work?**

Retrieval, extraction, chunking, and indexing are means. `verify-quote` is the
end. A feature earns its place by making that question cheaper or more reliable
to answer — not by making the corpus bigger.

The failure this guards against is a claim that _looks_ checkable: a plausible
sentence, a real DOI, a citation that renders correctly in a bibliography, and
nothing behind it. A tool that helps a researcher produce that faster is worse
than no tool.

## 2. A wrong answer is worse than no answer

A missing PDF is a visible gap. Someone notices it and fixes it.

A wrong PDF filed under the right name is silent corruption. It launders a
false citation into a checkable-looking one, and every layer downstream —
extraction, chunking, search, quote verification — faithfully processes the
wrong paper and reports success. The blast radius is the whole product.

So the asymmetry is deliberate: **when identity is uncertain, refuse and say
why.** A failure message a researcher can act on beats a file they will trust
by mistake. Coverage is never a reason to relax this.

## 3. Relevance is not identity

A search result is a candidate. Nothing more.

Ranking answers "what is most related to these words", which is not the
question we asked. An upstream API returning a confident first result is not
evidence; it is a suggestion. Papers that cannot possibly be in a corpus still
produce top hits there.

An artifact is what it claims to be only once we have checked it against the
identity we asked for — matching title, matching DOI, matching hash. Verify,
then trust.

## 4. Legitimate access only

We take the open route first, then the user's own front door. We never pick a
lock.

- Open access first: Unpaywall, Semantic Scholar, arXiv.
- Then the user's own entitlements: their institutional proxy, their
  credentials, at their instruction.
- We identify ourselves on every request (`User-Agent` with a contact address)
  and rate-limit every host.
- We do not scrape, circumvent, or crawl on our own initiative.

This is a tenet rather than a policy because it constrains what we build, not
just how we behave. Capability that only works by misrepresenting who we are
does not get built here, however much coverage it would buy.

## 5. Every stage is honest

A stage that cannot succeed is not in the cascade.

Capability that exists in code but cannot yet resolve a real PDF is **parked**
— unexported, unwired, still covered by its tests — rather than run on every
miss to append noise to a failure message. A stage rejoins when it can do its
job.

The same applies to reporting: a count of "downloaded" that includes items that
were not downloaded is a lie told to the only person who could catch the
problem.

## 6. Provenance or it didn't happen

Every artifact traces back: `retrieval_log` for what was attempted and from
where, `manifestations` for what is on disk, content hashes for what it is,
section paths for where in the document a chunk came from.

Grounding is the product. A passage we cannot trace to a source is not evidence,
and an answer built on it is a guess wearing a citation.

## 7. The core stays deterministic

Search, resolution, and verification are deterministic and inspectable. Given
the same corpus and the same query, they give the same answer, and a human can
follow why.

LLM-shaped features live outside that core and compose with it. The agent is
the shell; this is the instrument it reaches for. An instrument that guesses is
not an instrument.

## 8. One definition, thin adapters

Each concept is defined once and reached through thin adapters — one service
layer, MCP first, with other surfaces as gateways rather than parallel
implementations. Two mechanisms maintained side by side is a smell that needs a
justification and an end date.
