export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

function getConfiguredLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;
  return LEVELS[env] !== undefined ? env : 'info';
}

export function createLogger(name: string): Logger {
  function write(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
    const minLevel = LEVELS[getConfiguredLevel()];
    if (LEVELS[level] < minLevel) return;
    const line = JSON.stringify({ ...meta, ts: new Date().toISOString(), level, name, msg });
    process.stderr.write(line + '\n');
  }

  return {
    debug: (msg, meta) => write('debug', msg, meta),
    info:  (msg, meta) => write('info',  msg, meta),
    warn:  (msg, meta) => write('warn',  msg, meta),
    error: (msg, meta) => write('error', msg, meta),
  };
}

export const logger: Logger = createLogger('citation-needed');
