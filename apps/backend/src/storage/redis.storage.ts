import { RedisClient } from 'bun'

export function create_redis_client() {
  return new RedisClient(process.env.REDIS_URL!)
}
