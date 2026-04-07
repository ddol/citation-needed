# Institutional Proxy & Auth Setup

`sober-sources` never stores passwords. It only stores the **name of an environment variable** that holds the password at runtime.

## Configuration File

Auth config is stored in `~/.sober-sources/auth.json`. Example:

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
  ],
  "rateLimitMs": 1000
}
```

## CLI Configuration

```bash
# Set email for Unpaywall API
sober-sources auth set-email you@university.edu

# Add an institutional proxy
sober-sources auth add-proxy my-university https://proxy.university.edu \
  --username jdoe \
  --password-env PROXY_PASSWORD

# Show current config
sober-sources auth show
```

## Runtime Password

Set the password via environment variable at runtime:

```bash
export PROXY_PASSWORD="your_secret_password"
sober-sources download 10.1016/j.example.2024.001
```

## Unpaywall

Set your email (required by Unpaywall's terms of service):

```bash
sober-sources auth set-email your@email.com
```

Or pass it directly:

```bash
sober-sources download 10.1016/j.example --email your@email.com
```
