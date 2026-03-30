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

// ─── Redis implementation (atomic Lua script) ────────────────

// Atomic Lua script for rate limiting
// Returns: [allowed (1/0), remaining, retryAfter]
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local maxAttempts = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local data = redis.call('HGETALL', key)
local count = 0
local resetAt = 0

if #data > 0 then
  for i = 1, #data, 2 do
    if data[i] == 'count' then count = tonumber(data[i+1]) end
    if data[i] == 'resetAt' then resetAt = tonumber(data[i+1]) end
  end
end

if count == 0 or now > resetAt then
  local newResetAt = now + windowMs
  redis.call('HSET', key, 'count', '1', 'resetAt', tostring(newResetAt))
  redis.call('PEXPIRE', key, windowMs)
  return {1, maxAttempts - 1, 0}
end

if count >= maxAttempts then
  local retryAfter = math.ceil((resetAt - now) / 1000)
  return {0, 0, math.max(retryAfter, 1)}
end

redis.call('HINCRBY', key, 'count', 1)
return {1, maxAttempts - count - 1, 0}
`;

async function checkRateLimitRedis(
  client: Redis,
  key: string,
  maxAttempts: number,
  windowMs: number
): Promise<RateLimitResult> {
  try {
    const now = Date.now();
    const result = await client.eval(
      RATE_LIMIT_SCRIPT,
      1,
      key,
      String(maxAttempts),
      String(windowMs),
      String(now)
    ) as number[];

    const [allowed, remaining, retryAfter] = result;
    return {
      allowed: allowed === 1,
      remaining,
      retryAfter: retryAfter > 0 ? retryAfter : undefined,
    };
  } catch {
    // Redis error — fail open
    return { allowed: true, remaining: maxAttempts - 1 };
  }
}

// ─── In-memory fallback implementation ───────────────────────

const MAX_MEMORY_ENTRIES = 10000;

function checkRateLimitMemory(
  key: string,
  maxAttempts: number,
  windowMs: number
): RateLimitResult {
  // Evict expired entries if at capacity
  if (memoryStore.size >= MAX_MEMORY_ENTRIES) {
    const now = Date.now();
    let evicted = 0;
    for (const [k, entry] of memoryStore) {
      if (now > entry.resetAt) {
        memoryStore.delete(k);
        evicted++;
      }
    }
    // If still at capacity after cleanup, reject
    if (memoryStore.size >= MAX_MEMORY_ENTRIES) {
      return { allowed: false, remaining: 0, retryAfter: 60 };
    }
  }

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
