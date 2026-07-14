# Institutional Proxy & Auth Setup

`citation-needed` never stores passwords. It only stores the **name of an environment variable** that holds the password at runtime.

## Configuration File

Auth config is stored in `~/.citation-needed/auth.json`. Example:

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

## CLI Configuration

```bash
# Set email for Unpaywall API
citation-needed auth set-email you@university.edu

# Add an institutional proxy
citation-needed auth add-proxy my-university https://proxy.university.edu \
  --username jdoe \
  --password-env PROXY_PASSWORD

# Show current config
citation-needed auth show
```

## Runtime Password

Set the password via environment variable at runtime:

```bash
export PROXY_PASSWORD="your_secret_password"
citation-needed import-bibtex references.bib
```

Proxy credentials are used by the import/retrieval cascade when open-access
resolution fails. The standalone `download` CLI command does not use configured
institutional proxies; it requires `--url` or `--email` for an Unpaywall lookup.

## Unpaywall

Set your email (required by Unpaywall's terms of service):

```bash
citation-needed auth set-email your@email.com
```

Or pass it directly:

```bash
citation-needed download 10.1016/j.example --email your@email.com
```
