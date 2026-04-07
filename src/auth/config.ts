import fs from 'fs';
import path from 'path';
import { getDataDir, ensureDir } from '../utils/file';
import type { AuthConfig, ProxyConfig } from '../models/auth';
import { createLogger } from '../utils/logger';

const logger = createLogger('auth-config');

function getAuthConfigPath(): string {
  return path.join(getDataDir(), 'auth.json');
}

export function loadAuthConfig(): AuthConfig {
  const configPath = getAuthConfigPath();
  if (!fs.existsSync(configPath)) return {};
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as AuthConfig;
  } catch (err) {
    logger.warn('Failed to parse auth config', { err: String(err) });
    return {};
  }
}

export function saveAuthConfig(config: AuthConfig): void {
  const configPath = getAuthConfigPath();
  ensureDir(path.dirname(configPath));
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export function setEmail(email: string): void {
  const config = loadAuthConfig();
  config.email = email;
  saveAuthConfig(config);
}

export function addProxy(proxy: ProxyConfig): void {
  const config = loadAuthConfig();
  config.proxies = config.proxies || [];
  const idx = config.proxies.findIndex((p) => p.name === proxy.name);
  if (idx >= 0) {
    config.proxies[idx] = proxy;
  } else {
    config.proxies.push(proxy);
  }
  saveAuthConfig(config);
}

export function removeProxy(name: string): void {
  const config = loadAuthConfig();
  config.proxies = (config.proxies || []).filter((p) => p.name !== name);
  saveAuthConfig(config);
}
