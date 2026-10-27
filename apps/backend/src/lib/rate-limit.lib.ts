import type { RedisClient } from 'bun';
import { lib_error } from '@lib/error.lib';

export async function lib_rate_limit(redis: RedisClient, key: string, limit: number, window_seconds: number) {
  const count = await redis.incr(`rate:${key}`);
  if (count === 1) await redis.expire(`rate:${key}`, window_seconds);
  if (count > limit) throw lib_error.too_many_requests;
}
