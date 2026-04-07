export class RateLimiter {
  private lastCallTime = 0;

  constructor(private intervalMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCallTime;
    if (elapsed < this.intervalMs) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, this.intervalMs - elapsed)
      );
    }
    this.lastCallTime = Date.now();
  }
}
