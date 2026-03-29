/**
 * Redis-backed rate limiter.
 *
 * Falls back to in-memory when REDIS_URL is not configured (dev/single-instance).
 * Uses sliding window counter via Redis INCR + EXPIRE.
 */

import Redis from 'ioredis';

// ─── Redis client (lazy init) ────────────────────────────────

let redis: Redis | null = null;
let useRedis = false;

function getRedis(): Redis | null {
  if (redis !== null) return redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;

  redis = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy(times) {
      if (times > 3) return null; // stop retrying after 3 failures
      return Math.min(times * 200, 2000);
    },
  });

  redis.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
  });

  redis.on('connect', () => {
    useRedis = true;
    console.log('[Redis] Connected');
  });

  // Start connecting
  redis.connect().catch(() => {
    console.warn('[Redis] Failed to connect, falling back to in-memory rate limiting');
    redis = null;
  });

  return redis;
}

// ─── In-memory fallback ──────────────────────────────────────

const memoryStore = new Map<string, { count: number; resetAt: number }>();

// Periodic cleanup of expired entries (every 5 min)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryStore) {
    if (now > entry.resetAt) memoryStore.delete(key);
  }
}, 5 * 60 * 1000).unref();

// ─── Core rate limit function ────────────────────────────────

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter?: number; // seconds until window resets
}

/**
 * Check and increment rate limit for a given key.
 *
 * @param key       Unique identifier (e.g., "login:ip:1.2.3.4")
 * @param maxAttempts Maximum requests allowed in the window
 * @param windowMs  Window duration in milliseconds
 */
export async function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): Promise<RateLimitResult> {
  const client = getRedis();

  if (client && useRedis) {
    return checkRateLimitRedis(client, key, maxAttempts, windowMs);
  }

  return checkRateLimitMemory(key, maxAttempts, windowMs);
}

/**
 * Reset rate limit for a key (e.g., on successful login).
 */
export async function resetRateLimit(key: string): Promise<void> {
  const client = getRedis();
  if (client && useRedis) {
    await client.del(key).catch(() => {});
  } else {
    memoryStore.delete(key);
  }
}

// ─── Redis implementation ────────────────────────────────────

async function checkRateLimitRedis(
  client: Redis,
  key: string,
  maxAttempts: number,
  windowMs: number
): Promise<RateLimitResult> {
  try {
    const windowSec = Math.ceil(windowMs / 1000);
    const now = Date.now();

    // Use a Redis hash to track count + window start atomically
    const multi = client.multi();
    multi.hget(key, 'count');
    multi.hget(key, 'resetAt');
    const results = await multi.exec();

    const count = results?.[0]?.[1] ? parseInt(results[0][1] as string, 10) : 0;
    const resetAt = results?.[1]?.[1] ? parseInt(results[1][1] as string, 10) : 0;

    if (count === 0 || now > resetAt) {
      // New window
      const newResetAt = now + windowMs;
      const multi2 = client.multi();
      multi2.hset(key, { count: '1', resetAt: String(newResetAt) });
      multi2.pexpire(key, windowMs);
      await multi2.exec();

      return { allowed: true, remaining: maxAttempts - 1 };
    }

    if (count >= maxAttempts) {
      const retryAfter = Math.ceil((resetAt - now) / 1000);
      return { allowed: false, remaining: 0, retryAfter: Math.max(retryAfter, 1) };
    }

    // Increment
    await client.hincrby(key, 'count', 1);
    return { allowed: true, remaining: maxAttempts - count - 1 };
  } catch {
    // Redis error — fail open (allow the request)
    return { allowed: true, remaining: maxAttempts - 1 };
  }
}

// ─── In-memory fallback implementation ───────────────────────

function checkRateLimitMemory(
  key: string,
  maxAttempts: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const entry = memoryStore.get(key);

  if (!entry || now > entry.resetAt) {
    memoryStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxAttempts - 1 };
  }

  if (entry.count >= maxAttempts) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }

  entry.count++;
  return { allowed: true, remaining: maxAttempts - entry.count };
}

// ─── Token blocklist (Redis-backed with TTL) ─────────────────

/**
 * Add a token JTI to the blocklist.
 * In Redis: SET with TTL = remaining token validity → auto-expires, no cleanup needed.
 * In memory: Map entry with manual cleanup.
 */
export async function blockToken(jti: string, ttlSeconds: number): Promise<void> {
  const client = getRedis();

  if (client && useRedis) {
    try {
      await client.setex(`token:blocked:${jti}`, ttlSeconds, '1');
      return;
    } catch {
      // fall through to memory
    }
  }

  // Memory fallback
  memoryStore.set(`token:blocked:${jti}`, {
    count: 1,
    resetAt: Date.now() + ttlSeconds * 1000,
  });
}

/**
 * Check if a token JTI is blocklisted.
 */
export async function isTokenBlocked(jti: string): Promise<boolean> {
  const client = getRedis();

  if (client && useRedis) {
    try {
      const val = await client.exists(`token:blocked:${jti}`);
      return val === 1;
    } catch {
      // fail open — don't block valid tokens on Redis error
      return false;
    }
  }

  // Memory fallback
  const entry = memoryStore.get(`token:blocked:${jti}`);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    memoryStore.delete(`token:blocked:${jti}`);
    return false;
  }
  return true;
}
