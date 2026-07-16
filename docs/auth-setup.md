# Contact Email & Institutional Proxy Setup

Two independent things live in `~/.citation-needed/auth.json`: a **contact
email**, which enables Unpaywall and is the one setting nearly everyone needs,
and optional **institutional proxies** for paywalled content.

`citation-needed` never stores passwords. It only stores the **name of an
environment variable** that holds the password at runtime.

## Contact email (start here)

Unpaywall asks for an address so it can contact you about API usage. Without one,
**the Unpaywall stage is skipped** and retrieval continues with Semantic
Scholar's unauthenticated API, then arXiv by title. Semantic Scholar does not use
this email; set `SEMANTIC_SCHOLAR_API_KEY` for a better Semantic Scholar quota.

```bash
citation-needed auth set-email you@university.edu
```

Or set `CITATION_NEEDED_EMAIL`; `auth set-email` takes precedence. The address is
also sent as the contact in the downloader's `User-Agent`.

Use a real one. Unpaywall rejects placeholder domains with HTTP 422 (_"Please use
your own email address in API calls"_), so `@example.com` and friends are treated
as no address at all — the stage is skipped with a hint rather than spending a
request on a guaranteed rejection.

The standalone `download` command can take an address per-invocation instead:

```bash
citation-needed download 10.1016/j.example --email your@email.com
```

## Institutional proxies

Optional, and only relevant for content no open-access source carries. Proxy
credentials are used by the `import-bibtex` retrieval cascade when open-access
resolution fails. The standalone `download` command does not use them.

### Configure

```bash
citation-needed auth add-proxy my-university https://proxy.university.edu \
  --login-url https://proxy.university.edu/login \
  --username jdoe \
  --password-env PROXY_PASSWORD

citation-needed auth show   # passwordEnvVar is redacted
```

### Supply the password at runtime

```bash
export PROXY_PASSWORD="your_secret_password"
citation-needed import-bibtex references.bib
```

### Resulting `auth.json`

```json
{
  "email": "you@university.edu",
  "proxies": [
    {
      "name": "my-university",
      "proxyUrl": "https://proxy.university.edu",
      "loginUrl": "https://proxy.university.edu/login",
      "username": "jdoe",
      "passwordEnvVar": "PROXY_PASSWORD"
    }
  ]
}
```

Only the first configured proxy is used today; rotation across several is a
parked item in [plans/retrieval-pipeline.md](plans/retrieval-pipeline.md).
