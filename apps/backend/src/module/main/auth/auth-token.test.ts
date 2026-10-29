import { describe, expect, test } from 'bun:test'
import type { RedisClient } from 'bun'
import { Database } from 'bun:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lib_error } from '@lib/error.lib'
import { service_auth_token } from '@module/main/auth/auth-token.service'

function create_redis() {
  let now = 0
  const entries = new Map<string, { value: string; expires_at: number }>()
  const redis = {
    async set(key: string, value: string, _option: string, seconds: number, ...flags: string[]) {
      const previous = entries.get(key)
      entries.set(key, { value, expires_at: now + Number(seconds) })
      return flags.includes('GET') ? (previous && previous.expires_at > now ? previous.value : null) : 'OK'
    },
    async get(key: string) {
      const entry = entries.get(key)
      return entry && entry.expires_at > now ? entry.value : null
    },
    async getdel(key: string) {
      const entry = entries.get(key)
      entries.delete(key)
      return entry && entry.expires_at > now ? entry.value : null
    },
  } as unknown as Pick<RedisClient, 'set' | 'get' | 'getdel'>
  return { redis, entries, advance: (seconds: number) => { now += seconds } }
}

const user = { user_id: 1, user_email: 'user@example.com' }

describe('auth link tokens', () => {
  test('stores a hash of a random token, its owner, email and verification expiry', async () => {
    const { redis, entries } = create_redis()
    const first = await service_auth_token.create(user, 'email_verification', redis)
    const second = await service_auth_token.create(user, 'email_verification', redis)
    const hash = new Bun.CryptoHasher('sha256').update(second.token).digest('hex')

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.token).not.toBe(second.token)
    expect(first.expires_in).toBe(86400)
    expect(entries.get(`auth_token:email_verification:${hash}`)).toEqual({
      value: JSON.stringify(user), expires_at: 86400,
    })
    expect(JSON.stringify([...entries])).not.toContain(first.token)
    expect(JSON.stringify([...entries])).not.toContain(second.token)
    await expect(service_auth_token.delete(first.token, 'email_verification', redis)).rejects.toEqual(lib_error.invalid_token)
    expect(await service_auth_token.delete(second.token, 'email_verification', redis)).toEqual(user)
  })

  test('replacement also invalidates legacy tokens without a current-token pointer', async () => {
    const { redis } = create_redis()
    const legacy_token = 'a'.repeat(43)
    const hash = new Bun.CryptoHasher('sha256').update(legacy_token).digest('hex')
    await redis.set(`auth_token:email_verification:${hash}`, JSON.stringify(user), 'EX', 86400)
    const replacement = await service_auth_token.create(user, 'email_verification', redis)

    await expect(service_auth_token.delete(legacy_token, 'email_verification', redis)).rejects.toEqual(lib_error.invalid_token)
    expect(await service_auth_token.delete(replacement.token, 'email_verification', redis)).toEqual(user)
  })

  test('keeps a legacy emailed token usable before it is replaced', async () => {
    const { redis } = create_redis()
    const legacy_token = 'a'.repeat(43)
    const hash = new Bun.CryptoHasher('sha256').update(legacy_token).digest('hex')
    await redis.set(`auth_token:email_verification:${hash}`, JSON.stringify(user), 'EX', 86400)
    expect(await service_auth_token.delete(legacy_token, 'email_verification', redis)).toEqual(user)
  })

  test('replacing one purpose does not invalidate the other purpose', async () => {
    const { redis } = create_redis()
    const reset = await service_auth_token.create(user, 'password_reset', redis)
    await service_auth_token.create(user, 'email_verification', redis)
    await service_auth_token.create(user, 'email_verification', redis)
    expect(await service_auth_token.delete(reset.token, 'password_reset', redis)).toEqual(user)
  })

  test('replacing another user token does not invalidate this user token', async () => {
    const { redis } = create_redis()
    const first = await service_auth_token.create(user, 'email_verification', redis)
    const other = { user_id: 2, user_email: 'other@example.com' }
    await service_auth_token.create(other, 'email_verification', redis)
    await service_auth_token.create(other, 'email_verification', redis)
    expect(await service_auth_token.delete(first.token, 'email_verification', redis)).toEqual(user)
  })

  test('only the latest token survives concurrent issuance', async () => {
    const { redis } = create_redis()
    const tokens = await Promise.all([
      service_auth_token.create(user, 'email_verification', redis),
      service_auth_token.create(user, 'email_verification', redis),
    ])
    const results = await Promise.allSettled(tokens.map(({ token }) => service_auth_token.delete(token, 'email_verification', redis)))
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  })

  test('consumes a token once', async () => {
    const { redis } = create_redis()
    const { token } = await service_auth_token.create(user, 'email_verification', redis)

    expect(await service_auth_token.delete(token, 'email_verification', redis)).toEqual(user)
    await expect(service_auth_token.delete(token, 'email_verification', redis)).rejects.toEqual(lib_error.invalid_token)
  })

  test('only one concurrent consumer succeeds', async () => {
    const { redis } = create_redis()
    const { token } = await service_auth_token.create(user, 'password_reset', redis)
    const results = await Promise.allSettled([
      service_auth_token.delete(token, 'password_reset', redis),
      service_auth_token.delete(token, 'password_reset', redis),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })

  test('a verification token cannot reset a password or be consumed by that purpose', async () => {
    const { redis } = create_redis()
    const { token } = await service_auth_token.create(user, 'email_verification', redis)

    await expect(service_auth_token.delete(token, 'password_reset', redis)).rejects.toEqual(lib_error.invalid_token)
    expect(await service_auth_token.delete(token, 'email_verification', redis)).toEqual(user)
  })

  test.each(['email_verification', 'password_reset'] as const)('rejects an expired %s token', async (purpose) => {
    const { redis, advance } = create_redis()
    const { token, expires_in } = await service_auth_token.create(user, purpose, redis)
    expect(expires_in).toBe(purpose === 'email_verification' ? 86400 : 1800)
    advance(expires_in)

    await expect(service_auth_token.delete(token, purpose, redis)).rejects.toEqual(lib_error.invalid_token)
  })

  test('rejects an unknown token', async () => {
    const { redis } = create_redis()
    await expect(service_auth_token.delete('unknown', 'email_verification', redis)).rejects.toEqual(lib_error.invalid_token)
  })
})

test('verification migration preserves existing users and defaults new users to unverified', () => {
  const database = new Database(':memory:')
  const directory = join(import.meta.dir, '../../../../prisma/main/migrations')
  const migration = '20261028140000_email_verification'
  try {
    for (const name of readdirSync(directory).filter((name) => name < migration && /^\d/.test(name)).sort()) {
      database.exec(readFileSync(join(directory, name, 'migration.sql'), 'utf8'))
    }
    database.run('INSERT INTO user (user_email, user_first_name, user_last_name) VALUES (?, ?, ?)', ['existing@example.com', 'Existing', 'User'])
    database.exec(readFileSync(join(directory, migration, 'migration.sql'), 'utf8'))
    database.run('INSERT INTO user (user_email, user_first_name, user_last_name) VALUES (?, ?, ?)', ['new@example.com', 'New', 'User'])

    expect(database.query('SELECT user_email, user_email_verified_at FROM user ORDER BY user_id').all()).toEqual([
      { user_email: 'existing@example.com', user_email_verified_at: null },
      { user_email: 'new@example.com', user_email_verified_at: null },
    ])
    database.run('UPDATE user SET user_email_verified_at = ? WHERE user_id = 1', ['2026-10-28T12:00:00.000Z'])
    expect(database.query('SELECT user_email_verified_at FROM user WHERE user_id = 1').get()).toEqual({
      user_email_verified_at: '2026-10-28T12:00:00.000Z',
    })
    database.exec(readFileSync(join(directory, '20261029120000_password_reset_sessions', 'migration.sql'), 'utf8'))
    expect(database.query('SELECT user_email, user_session_version FROM user ORDER BY user_id').all()).toEqual([
      { user_email: 'existing@example.com', user_session_version: 0 },
      { user_email: 'new@example.com', user_session_version: 0 },
    ])
  } finally {
    database.close()
  }
})
