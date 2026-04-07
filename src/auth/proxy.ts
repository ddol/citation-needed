import type { ProxyConfig } from '../models/auth';

/** Resolve proxy password from the configured env variable */
export function resolvePassword(proxy: ProxyConfig): string | undefined {
  if (!proxy.passwordEnvVar) return undefined;
  return process.env[proxy.passwordEnvVar];
}

/** Build the proxy login URL with target URL appended */
export function buildProxyLoginUrl(proxy: ProxyConfig, targetUrl: string): string {
  const base = proxy.loginUrl || proxy.proxyUrl;
  const encoded = encodeURIComponent(targetUrl);
  return `${base}?url=${encoded}`;
}
