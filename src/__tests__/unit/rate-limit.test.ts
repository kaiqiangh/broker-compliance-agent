import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Ensure no REDIS_URL so in-memory fallback is used
vi.stubEnv('REDIS_URL', '');

import {
  checkRateLimit,
  resetRateLimit,
  blockToken,
  isTokenBlocked,
} from '../../lib/rate-limit';

describe('checkRateLimit (in-memory)', () => {
  beforeEach(() => {
    // Each test uses a unique key to avoid cross-test pollution
  });

  it('allows first request with remaining=max-1', async () => {
    const key = `rl-test-${Date.now()}-1`;
    const result = await checkRateLimit(key, 5, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('decrements remaining on subsequent requests', async () => {
    const key = `rl-test-${Date.now()}-2`;
    await checkRateLimit(key, 5, 60_000);
    const second = await checkRateLimit(key, 5, 60_000);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(3);

    const third = await checkRateLimit(key, 5, 60_000);
    expect(third.remaining).toBe(2);
  });

  it('blocks after max attempts exceeded', async () => {
    const key = `rl-test-${Date.now()}-3`;
    const max = 3;
    for (let i = 0; i < max; i++) {
      await checkRateLimit(key, max, 60_000);
    }
    const blocked = await checkRateLimit(key, max, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it('resets after window expires', async () => {
    vi.useFakeTimers();
    const key = `rl-test-${Date.now()}-4`;
    const windowMs = 10_000;

    // Exhaust the limit
    for (let i = 0; i < 3; i++) {
      await checkRateLimit(key, 3, windowMs);
    }
    const blocked = await checkRateLimit(key, 3, windowMs);
    expect(blocked.allowed).toBe(false);

    // Advance past the window
    vi.advanceTimersByTime(windowMs + 100);

    const afterReset = await checkRateLimit(key, 3, windowMs);
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(2);

    vi.useRealTimers();
  });

  it('resetRateLimit clears the counter', async () => {
    const key = `rl-test-${Date.now()}-5`;
    await checkRateLimit(key, 2, 60_000);
    await checkRateLimit(key, 2, 60_000);

    // Now blocked
    const blocked = await checkRateLimit(key, 2, 60_000);
    expect(blocked.allowed).toBe(false);

    // Reset
    await resetRateLimit(key);

    const afterReset = await checkRateLimit(key, 2, 60_000);
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(1);
  });
});

describe('blockToken / isTokenBlocked (in-memory)', () => {
  it('reports blocked token as true', async () => {
    const jti = `jti-${Date.now()}-1`;
    await blockToken(jti, 3600);
    expect(await isTokenBlocked(jti)).toBe(true);
  });

  it('reports non-blocked token as false', async () => {
    const jti = `jti-${Date.now()}-2`;
    expect(await isTokenBlocked(jti)).toBe(false);
  });

  it('expires blocked token after TTL', async () => {
    vi.useFakeTimers();
    const jti = `jti-${Date.now()}-3`;

    await blockToken(jti, 1);

    // Still blocked immediately
    expect(await isTokenBlocked(jti)).toBe(true);

    // Advance 1.5 seconds
    vi.advanceTimersByTime(1500);

    expect(await isTokenBlocked(jti)).toBe(false);

    vi.useRealTimers();
  });
});
