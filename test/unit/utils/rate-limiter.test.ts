import { RateLimiter } from '../../../src/utils/rate-limiter';

describe('RateLimiter', () => {
  test('can be instantiated', () => {
    const limiter = new RateLimiter(100);
    expect(limiter).toBeDefined();
  });

  test('wait() resolves immediately on first call', async () => {
    const limiter = new RateLimiter(50);
    const start = Date.now();
    await limiter.wait();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  test('wait() delays on second call within interval', async () => {
    const limiter = new RateLimiter(100);
    await limiter.wait(); // first call
    const start = Date.now();
    await limiter.wait(); // second call should wait
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(80); // allow 20ms slack
  }, 1000);

  test('wait() does not delay after interval has passed', async () => {
    const limiter = new RateLimiter(50);
    await limiter.wait();
    await new Promise((r) => setTimeout(r, 60)); // wait out the interval
    const start = Date.now();
    await limiter.wait();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  }, 1000);
});
