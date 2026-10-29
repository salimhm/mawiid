import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { RedisClient } from 'bun'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Elysia } from 'elysia'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import type { create_database_client } from '@db/client.db'
import { PrismaClient } from '@db/generated/main/client'
import { apply_migration } from '@db/utils.db'
import { lib_middleware_error } from '@lib/middleware.lib'
import { service_auth_token } from '@module/main/auth/auth-token.service'

process.env.JWT_SECRET_KEY = 'mawiid-test-jwt-secret'
const { controller_auth } = await import('@module/main/auth/auth.controller')
const directory = mkdtempSync(join(tmpdir(), 'mawiid-auth-'))
const url = `file:${join(directory, 'main.db')}`
const main_db = new PrismaClient({ adapter: new PrismaLibSql({ url }) })

beforeAll(async () => {
  await apply_migration(url, join(import.meta.dir, '../../../../prisma/main/migrations'), 'local')
})

afterAll(async () => {
  await main_db.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

async function create_fixture() {
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
  } as unknown as RedisClient
  const user = await main_db.user.create({ data: {
    user_email: `${crypto.randomUUID()}@example.com`, user_first_name: 'Test', user_last_name: 'User',
  } })
  const database = { main_db } as unknown as ReturnType<typeof create_database_client>
  const app = new Elysia().decorate('database', database).decorate('redis', redis).use(lib_middleware_error).use(controller_auth).compile()
  const issued = await service_auth_token.create({ user_id: user.user_id, user_email: user.user_email! }, 'email_verification', redis)

  function request(body: unknown = { token: issued.token }) {
    return app.handle(new Request('http://localhost/auth/email/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }))
  }

  return { app, request, user, redis, issued, advance: (seconds: number) => { now += seconds } }
}

describe('POST /auth/email/verify', () => {
  test('verifies the token owner without login and creates no session', async () => {
    const { request, user } = await create_fixture()
    const response = await request()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { email_verified: true } })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect((await main_db.user.findUniqueOrThrow({ where: { user_id: user.user_id } })).user_email_verified_at).toBeInstanceOf(Date)
  })

  test('rejects reuse without overwriting the original verification timestamp', async () => {
    const { request, user } = await create_fixture()
    await request()
    const first = await main_db.user.findUniqueOrThrow({ where: { user_id: user.user_id } })
    const response = await request()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'invalid-token' })
    expect((await main_db.user.findUniqueOrThrow({ where: { user_id: user.user_id } })).user_email_verified_at).toEqual(first.user_email_verified_at)
  })

  test('only one concurrent verification succeeds', async () => {
    const { request } = await create_fixture()
    const responses = await Promise.all([request(), request()])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 401])
  })

  test('rejects expired tokens', async () => {
    const { request, issued, advance, user } = await create_fixture()
    advance(issued.expires_in)
    const response = await request()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'invalid-token' })
    expect((await main_db.user.findUniqueOrThrow({ where: { user_id: user.user_id } })).user_email_verified_at).toBeNull()
  })

  test('rejects an unknown token', async () => {
    const { request } = await create_fixture()
    const response = await request({ token: 'a'.repeat(43) })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'invalid-token' })
  })

  test('rejects password-reset tokens without consuming them', async () => {
    const { request, user, redis } = await create_fixture()
    const data = { user_id: user.user_id, user_email: user.user_email! }
    const { token } = await service_auth_token.create(data, 'password_reset', redis)
    const response = await request({ token })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'invalid-token' })
    expect(await service_auth_token.delete(token, 'password_reset', redis)).toEqual(data)
  })

  test('rejects a token whose user does not exist', async () => {
    const { request, redis } = await create_fixture()
    const { token } = await service_auth_token.create({ user_id: 999999, user_email: 'missing@example.com' }, 'email_verification', redis)
    const response = await request({ token })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'invalid-token' })
  })

  test.each(['deleted', 'changed_email', 'already_verified'])('rejects a token for a %s account', async (state) => {
    const { request, user } = await create_fixture()
    const verified_at = new Date('2026-10-01T12:00:00Z')
    await main_db.user.update({ where: { user_id: user.user_id }, data: {
      ...(state === 'deleted' ? { deleted_at: new Date() } : {}),
      ...(state === 'changed_email' ? { user_email: `${crypto.randomUUID()}@example.com` } : {}),
      ...(state === 'already_verified' ? { user_email_verified_at: verified_at } : {}),
    } })
    const response = await request()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'invalid-token' })
    expect((await main_db.user.findUniqueOrThrow({ where: { user_id: user.user_id } })).user_email_verified_at).toEqual(state === 'already_verified' ? verified_at : null)
  })

  test('ignores a caller-supplied user ID and verifies only the token owner', async () => {
    const { request, issued, user } = await create_fixture()
    const other = await main_db.user.create({ data: { user_first_name: 'Other', user_last_name: 'User' } })
    const response = await request({ token: issued.token, user_id: other.user_id })

    expect(response.status).toBe(200)
    expect((await main_db.user.findUniqueOrThrow({ where: { user_id: user.user_id } })).user_email_verified_at).toBeInstanceOf(Date)
    expect((await main_db.user.findUniqueOrThrow({ where: { user_id: other.user_id } })).user_email_verified_at).toBeNull()
  })

  test.each([{}, { token: '' }, { token: 1 }, { token: 'a'.repeat(42) }, { token: 'a'.repeat(44) }, { token: '!'.repeat(43) }])('rejects malformed input %j', async (body) => {
    const { request, user } = await create_fixture()
    const response = await request(body)
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      code: 'validation-error',
      message: 'Please check the information you entered.',
      errors: [{ field: 'token', message: 'This verification link is invalid.' }],
    })
    expect((await main_db.user.findUniqueOrThrow({ where: { user_id: user.user_id } })).user_email_verified_at).toBeNull()
  })
})
