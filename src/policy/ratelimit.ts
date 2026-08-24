// Token bucket rate limiter — mencegah request LLM beruntun kena 429.
// Capacity = burst allowance; refill per ms dari rpm.

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private capacity: number,
    private refillPerMs: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
      this.lastRefill = now;
    }
  }

  /** Ambil 1 token; tunggu bila bucket kosong. */
  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = Math.ceil((1 - this.tokens) / this.refillPerMs);
    await new Promise((r) => setTimeout(r, Math.max(0, waitMs)));
    this.refill();
    this.tokens = Math.max(0, this.tokens - 1);
  }

  /** Info status (untuk /status). */
  info(): { capacity: number; available: number; rpm: number } {
    this.refill();
    return { capacity: this.capacity, available: this.tokens, rpm: Math.round(this.refillPerMs * 60_000) };
  }
}

// Buat limiter dari rpm (requests per minute). Burst = min(rpm, 10).
export function createRateLimiter(rpm: number): RateLimiter {
  const safe = Math.max(1, rpm);
  const capacity = Math.max(1, Math.min(Math.floor(safe), 10));
  return new RateLimiter(capacity, safe / 60_000);
}