import { HttpError } from './errors';

export interface RateLimiterOptions {
  /** Max hits allowed in a burst. */
  limit: number;
  /** Time for the bucket to refill completely. */
  windowMs: number;
  now?: () => number;
}

interface Bucket {
  tokens: number;
  updated: number;
}

/**
 * In-memory token bucket keyed by string (IP, kit id, attendee id...).
 * One process, so in-memory is correct. Buckets that refill fully are
 * dropped by sweep() to keep memory flat.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(opts: RateLimiterOptions) {
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
    this.now = opts.now ?? Date.now;
  }

  private bucket(key: string): Bucket {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.limit, updated: t };
      this.buckets.set(key, b);
    } else {
      const refill = ((t - b.updated) / this.windowMs) * this.limit;
      b.tokens = Math.min(this.limit, b.tokens + refill);
      b.updated = t;
    }
    return b;
  }

  /** Seconds until one token is available (0 if available now). */
  retryAfter(key: string): number {
    const b = this.bucket(key);
    if (b.tokens >= 1) return 0;
    return Math.ceil(((1 - b.tokens) * this.windowMs) / this.limit / 1000);
  }

  /** Would a hit be allowed? Does not consume. */
  allowed(key: string): boolean {
    return this.bucket(key).tokens >= 1;
  }

  /** Consume one token. Returns false (and consumes nothing) if empty. */
  hit(key: string): boolean {
    const b = this.bucket(key);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** Consume or throw a 429 in the shared error shape. */
  enforce(key: string, message = 'Slow down a little and try again.'): void {
    if (!this.hit(key)) throw new HttpError(429, 'rate_limited', message, { retryAfter: Math.max(1, this.retryAfter(key)) });
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  sweep(): void {
    for (const key of [...this.buckets.keys()]) {
      const b = this.bucket(key);
      if (b.tokens >= this.limit) this.buckets.delete(key);
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}
