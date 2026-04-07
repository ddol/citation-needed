import { RateLimiter } from '../../../src/utils/rate-limiter';

describe('RateLimiter', () => {
  test('can be instantiated', () => {
    const limiter = new RateLimiter(100);
    expect(limiter).toBeDefined();
  });

  test('wait() resolves after the interval', async () => {
    const limiter = new RateLimiter(50);
    const start = Date.now();
    await limiter.wait();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40); // allow 10ms slack
  });

  test('wait() serializes concurrent calls', async () => {
    const limiter = new RateLimiter(50);
    const start = Date.now();
    // Fire two concurrent waits
    await Promise.all([limiter.wait(), limiter.wait()]);
    const elapsed = Date.now() - start;
    // Two serialized 50ms waits should take ~100ms total
    expect(elapsed).toBeGreaterThanOrEqual(80); // allow slack
  }, 1000);

  test('successive waits each add the interval', async () => {
    const limiter = new RateLimiter(50);
    const start = Date.now();
    await limiter.wait();
    await limiter.wait();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(80);
  }, 1000);
});
