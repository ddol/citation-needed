export interface ProxyConfig {
  name: string;
  proxyUrl: string;
  loginUrl?: string;
  username?: string;
  /** Name of env variable holding the password (never stored directly) */
  passwordEnvVar?: string;
}

export interface AuthConfig {
  email?: string;       // for Unpaywall API
  proxies?: ProxyConfig[];
}
