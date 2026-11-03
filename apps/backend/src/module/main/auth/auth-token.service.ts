import type { RedisClient } from 'bun'
import { lib_error } from '@lib/error.lib'

type auth_token_purpose = 'email_verification' | 'password_reset'
type auth_token_data = { user_id: number; user_email: string; user_session_version?: number }
type auth_token_redis = Pick<RedisClient, 'set' | 'get' | 'getdel'>

const token_ttl_seconds = {
  email_verification: 24 * 60 * 60,
  password_reset: 30 * 60,
}

function token_key(token: string, purpose: auth_token_purpose) {
  const hash = new Bun.CryptoHasher('sha256').update(token).digest('hex')
  return `auth_token:${purpose}:${hash}`
}

function current_key(user_id: number, purpose: auth_token_purpose) {
  return `auth_token_current:${purpose}:${user_id}`
}

export const service_auth_token = {
  async create(data: auth_token_data, purpose: auth_token_purpose, redis: auth_token_redis) {
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
    const expires_in = token_ttl_seconds[purpose]
    const key = token_key(token, purpose)
    await redis.set(key, JSON.stringify(data), 'EX', expires_in)
    const previous = await redis.set(current_key(data.user_id, purpose), key, 'EX', String(expires_in), 'GET')
    if (previous) await redis.getdel(previous)
    return { token, expires_in }
  },

  async delete(token: string, purpose: auth_token_purpose, redis: auth_token_redis): Promise<auth_token_data> {
    const key = token_key(token, purpose)
    const stored = await redis.getdel(key)
    if (!stored) throw lib_error.invalid_token
    const data = JSON.parse(stored) as auth_token_data
    const current = await redis.get(current_key(data.user_id, purpose))
    if (current && current !== key) throw lib_error.invalid_token
    return data
  },
}
