import type { RedisClient } from 'bun';
import { lib_error } from '@lib/error.lib';

/**
 * Counts one more hit on `key` and returns the count in the current window. The window's TTL is
 * set before the first increment, so a crash can never leave a counter without expiry (which would
 * lock the key out forever), and concurrent callers each get their own count.
 */
export async function lib_rate_count(redis: RedisClient, key: string, window_seconds: number) {
  await redis.set(key, '0', 'EX', String(window_seconds), 'NX');
  return await redis.incr(key);
}

export async function lib_rate_limit(redis: RedisClient, key: string, limit: number, window_seconds: number) {
  const count = await lib_rate_count(redis, `rate:${key}`, window_seconds);
  if (count > limit) throw lib_error.too_many_requests;
}
