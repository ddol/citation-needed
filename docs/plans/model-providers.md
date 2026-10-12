# Model providers, roles, and keys

| Field      | Value                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------ |
| Status     | **Core: slice 4** (spend estimate: slice 7)                                                      |
| Flow       | Infrastructure (serves Dossier)                                                                  |
| Depends on | [http-api.md](http-api.md) for the settings routes; [web-ui.md](web-ui.md) for the settings page |

## Intent

One interface for calling a language model, three providers behind it
(Anthropic, OpenRouter, Ollama), roles mapped to models in configuration, keys
entered in the web UI and stored locally, and every call recorded so the
dossier footer can state exactly what ran.

## Current state

- No model calls anywhere. `axios` is a dependency, and
  `src/retrieval/http-retry.ts` exports the retry policy (`isTransient`,
  `backoffMs`: `Retry-After` when offered, else exponential).
- `~/.citation-needed/auth.json` (`src/auth/config.ts`) holds the contact email
  and proxy definitions. Proxy passwords stay in environment variables the
  config names; nothing secret is stored.
- `SEMANTIC_SCHOLAR_API_KEY` is read from the environment only.

## Design

### One interface, two wire formats

```ts
interface ModelProvider {
  id: 'anthropic' | 'openrouter' | 'ollama';
  complete(request: CompletionRequest): Promise<CompletionResult>;
  listModels(): Promise<ModelInfo[]>; // id, family, vision, context window
  test(): Promise<ProviderHealth>; // list models + a 1-token completion
}

interface CompletionRequest {
  model: string;
  system: string;
  parts: Array<
    { type: 'text'; text: string } | { type: 'image'; mediaType: 'image/png'; data: Buffer }
  >;
  maxTokens: number;
  temperature: number; // 0 unless a role overrides it
  json?: boolean; // ask for a JSON object; parsed and zod-validated by the caller
}

interface CompletionResult {
  text: string;
  resolvedModel: string; // as the provider's response reports it
  usage: { inputTokens: number; outputTokens: number; costUsd?: number };
  finishReason: 'stop' | 'length';
}
```

**Two adapters cover three providers.**

| Adapter             | Provider   | Endpoint                                      | Auth                            |
| ------------------- | ---------- | --------------------------------------------- | ------------------------------- |
| `anthropic`         | Anthropic  | Messages API                                  | `x-api-key`                     |
| `openai-compatible` | OpenRouter | `https://openrouter.ai/api/v1`                | bearer key                      |
| `openai-compatible` | Ollama     | `http://localhost:11434/v1`, or hosted Ollama | none locally; bearer key hosted |

OpenRouter and Ollama differ in base URL, auth header, and model-list endpoint,
nothing else, so they are two configurations of one adapter. Both adapters use
`axios` with the shared retry policy from `http-retry.ts`, generalized from GET
to POST: one retry rule for every upstream, one way to mock HTTP in tests.

Cost comes from the provider when it reports one (OpenRouter's usage
accounting), is zero for local Ollama, and is otherwise computed from a
user-editable price table and labelled as an estimate.

### Roles

**Code asks for a role, never a model**: `models.forRole('math')`. Assignments
live in the persistent config file, edited through the settings page:

```json
{
  "roles": {
    "reader": { "provider": "anthropic", "model": "claude-sonnet-5-5" },
    "math": { "provider": "openrouter", "model": "<vision model>" },
    "figure": { "provider": "ollama", "model": "<local vision model>" },
    "writer": { "provider": "anthropic", "model": "claude-opus-5-5" },
    "auditor": { "provider": "openrouter", "model": "<vision model, other family>" }
  },
  "limits": { "maxTokensPerDossier": 2000000, "concurrencyPerProvider": 4 }
}
```

A zod schema validates the config before any dossier starts:

- Every role is assigned, explicitly or by the one-key default below.
- `math`, `figure`, and `auditor` models accept images, read from model-list
  metadata (OpenRouter's input modalities, Ollama's model capabilities; every
  current Anthropic model accepts images).
- The auditor's family differs from the reader's and the writer's. Family is the
  vendor (`anthropic/…` through OpenRouter and the direct `anthropic` provider
  are one family). A shared or unknown family is a warning, not a block, and the
  footer records it.

**One key is enough to start.** With a single provider configured, every role
defaults to it: Anthropic and OpenRouter to a current Claude Sonnet model, Ollama
to the first installed vision-capable model. The defaults live in config, show
in the settings page, and change once the dossier eval has numbers. The auditor
is then the same family as the writer, so the dossier runs and its footer says
the audit was not independent.

### Prompts are versioned files

Each role's system prompt and output schema live in one file per role under the
dossier module. The prompt-set hash (sha256 over those files) is stored on every
model run and printed in the footer. Editing a prompt changes the hash, which
invalidates that stage's cached outputs and nothing upstream of it.

### Keys

| Provider         | Key                  | Read from                                                                      |
| ---------------- | -------------------- | ------------------------------------------------------------------------------ |
| Anthropic        | required             | `ANTHROPIC_API_KEY`, else the secrets file                                     |
| OpenRouter       | required             | `OPENROUTER_API_KEY`, else the secrets file                                    |
| Ollama           | hosted endpoint only | `OLLAMA_API_KEY`, else the secrets file; base URL from `OLLAMA_HOST` or config |
| Semantic Scholar | optional             | `SEMANTIC_SCHOLAR_API_KEY`, else the secrets file                              |

**Keys live in `~/.citation-needed/secrets.json`, mode 0600, in a 0700
directory.** The file is created with 0600 before any byte is written, and
replaced atomically (temp file, then rename). A secrets file readable by group
or others is refused with a message naming the `chmod` fix, the rule ssh applies
to private keys.

- An environment variable wins over the file, so shell and CI users never need
  the UI.
- Keys never enter SQLite, logs, error messages, job payloads, dossiers, or HTTP
  responses. The API reports `{ set, source: 'env' | 'file', hint }`, where the
  hint is the last four characters.
- Keys are write-only through the UI: set, replace, delete, never read back.
- The logger redacts any loaded key value before writing a line.
- `auth.json` stays free of secrets; the secrets file is the one place any key
  is stored.

### Data leaving the machine

Source content goes to the providers the roles name, and nowhere else. The
settings page shows, per role, whether that role's input leaves the machine. An
all-Ollama assignment on localhost runs a dossier fully offline. A source not
retrieved as open access reaches a remote role only after the user confirms it
for that dossier ([dossier.md](dossier.md#source-access-and-disclosure)).

### Recording every call

```sql
CREATE TABLE model_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dossier_id INTEGER REFERENCES dossiers(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  role TEXT NOT NULL,
  provider TEXT NOT NULL,
  requested_model TEXT NOT NULL,
  resolved_model TEXT,
  prompt_hash TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  temperature REAL NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'truncated', 'error')),
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
```

The row is metadata; the output itself lands on the `dossier_parts` row that
references it. A call whose provider, model, prompt hash, input hash, and
temperature match a prior `ok` run reuses that output instead of calling again.

### Spend limits

**A per-dossier token cap stops a runaway job.** The worker checks cumulative
tokens before each call and pauses the job when the next call would cross the
cap; the UI offers resume with a raised cap. Slice 7 adds an estimate before
start, computed from the profile (expected tokens per part times part count).

## Rejected alternatives

- **One vendor SDK per provider.** Three dependencies, three retry policies,
  three error shapes, for two HTTP endpoints. Thin adapters over the shared
  retry policy are less surface.
- **An LLM framework (LangChain, LiteLLM, an AI SDK).** A framework to call two
  endpoints; it would also own retries and logging the project already defines.
- **OpenRouter only.** One key reaches every family, but direct Anthropic
  access and local Ollama are both first-class requirements: data terms,
  pricing, and offline runs.
- **Keys in SQLite.** The database gets copied, attached to bug reports, and
  read by sibling tools; secrets do not belong in it.
- **The OS keychain.** No maintained cross-platform Node binding without native
  builds (`keytar` is archived). `@napi-rs/keyring` is the upgrade path if file
  permissions prove insufficient.
- **An encrypted secrets file.** The decryption key either sits beside the file
  or needs a passphrase on every start. File permissions are the protection
  `gh`, `aws`, and ssh rely on.

## Phasing

1. Secrets store and env precedence; logger redaction.
2. `openai-compatible` adapter (OpenRouter, Ollama) and `anthropic` adapter,
   fixture-tested.
3. Persistent config file with role assignments and limits; zod validation.
4. `model_runs` migration; output reuse by input hash.
5. Settings routes and page ([web-ui.md](web-ui.md)).

## Backlog items

- [cfg] S - Secrets store: ~/.citation-needed/secrets.json at 0600 in a 0700 dir, atomic writes, group/other-readable file refused; env vars win; masked hints; holds the Semantic Scholar key too (see docs/plans/model-providers.md)
- [util] XS - Logger redacts loaded key values (see docs/plans/model-providers.md)
- [api] M - ModelProvider interface with anthropic and openai-compatible adapters (OpenRouter, Ollama); text + image parts, resolved model, usage, cost; shared http-retry policy (see docs/plans/model-providers.md)
- [cfg] M - Persistent config file with role assignments and limits; one-key defaults (every role on the single configured provider); zod validation: all roles set, vision for math/figure/auditor, auditor family independence warning (see docs/plans/model-providers.md)
- [db] M - model_runs table; output reuse when provider, model, prompt hash, input hash, and temperature match (see docs/plans/model-providers.md)
- [flow] S - Per-dossier token cap: pause before the call that would cross it, resume with a raised cap (see docs/plans/model-providers.md)
- [flow] S - Spend estimate before start from the source profile (see docs/plans/model-providers.md)

## Testing

- Adapters against recorded fixtures with HTTP mocked: request shape per
  provider (system prompt, image parts, temperature, JSON mode), resolved-model
  and usage parsing, 429 retry with `Retry-After`, error mapping.
- Secrets: file created at 0600; a group-readable file is refused; env
  precedence; masked hint; a loaded key never appears in log output; no route
  response contains a key.
- Config: unassigned role, non-vision model on a vision role, same-family
  auditor warning.
- Output reuse: an identical call is served from the prior run; a prompt edit
  forces a new call.

## Open questions

1. Fold `auth.json` into the persistent config file so non-secret settings live
   in one place? Likely yes, when the config file lands.

## Relationship to other plans

- [dossier.md](dossier.md): the roles and the footer this plan's records feed.
- [web-ui.md](web-ui.md): the settings page over these services.
- [http-api.md](http-api.md): the settings routes and server security rules.
- [retrieval-pipeline.md](retrieval-pipeline.md): owns `http-retry.ts`, now
  shared with the model adapters.
