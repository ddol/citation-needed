export class RateLimiter {
  private pending: Promise<void> = Promise.resolve();

  constructor(private intervalMs: number) {}

  async wait(): Promise<void> {
    const ticket = this.pending.then(() =>
      new Promise<void>((resolve) => setTimeout(resolve, this.intervalMs))
    );
    this.pending = ticket;
    return ticket;
  }
}
