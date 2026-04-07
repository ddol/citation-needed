import { createLogger, logger } from '../../../src/utils/logger';

describe('Logger', () => {
  test('createLogger returns a logger object', () => {
    const log = createLogger('test');
    expect(log).toHaveProperty('debug');
    expect(log).toHaveProperty('info');
    expect(log).toHaveProperty('warn');
    expect(log).toHaveProperty('error');
  });

  test('default logger exists and is usable', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
  });

  test('logger methods do not throw', () => {
    const log = createLogger('test-no-throw');
    expect(() => log.debug('debug message')).not.toThrow();
    expect(() => log.info('info message')).not.toThrow();
    expect(() => log.warn('warn message')).not.toThrow();
    expect(() => log.error('error message')).not.toThrow();
  });

  test('logger accepts metadata', () => {
    const log = createLogger('test-meta');
    expect(() => log.info('message with meta', { key: 'value', num: 42 })).not.toThrow();
  });

  test('multiple loggers with different names are independent', () => {
    const logA = createLogger('module-a');
    const logB = createLogger('module-b');
    expect(logA).not.toBe(logB);
    expect(() => {
      logA.info('from A');
      logB.info('from B');
    }).not.toThrow();
  });
});
