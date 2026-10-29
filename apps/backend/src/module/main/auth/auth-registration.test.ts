import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import type { RedisClient } from 'bun'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Elysia } from 'elysia'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import type { create_database_client } from '@db/client.db'
import { PrismaClient } from '@db/generated/main/client'
import { apply_migration } from '@db/utils.db'
import { lib_error } from '@lib/error.lib'
import { lib_middleware_error } from '@lib/middleware.lib'
import { service_email } from '@module/main/email/email.service'
import { service_auth_token } from '@module/main/auth/auth-token.service'

process.env.JWT_SECRET_KEY = 'mawiid-test-jwt-secret'
const { controller_auth } = await import('@module/main/auth/auth.controller')
const { lib_jwt, lib_jwt_sign } = await import('@lib/jwt.lib')
const directory = mkdtempSync(join(tmpdir(), 'mawiid-registration-'))
const url = `file:${join(directory, 'main.db')}`
const main_db = new PrismaClient({ adapter: new PrismaLibSql({ url }) })
const previous_env = { ENV: process.env.ENV, PUBLIC_APP_URL: process.env.PUBLIC_APP_URL }

beforeAll(async () => {
  await apply_migration(url, join(import.meta.dir, '../../../../prisma/main/migrations'), 'local')
})

beforeEach(() => {
  process.env.ENV = 'dev'
  process.env.PUBLIC_APP_URL = 'http://localhost:3100'
})

afterEach(() => {
  mock.restore()
  for (const key of ['ENV', 'PUBLIC_APP_URL'] as const) {
    if (previous_env[key] === undefined) delete process.env[key]
    else process.env[key] = previous_env[key]
  }
})

afterAll(async () => {
  await main_db.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

function create_fixture() {
  let now = 0
  const state = { fail_tokens: false }
  const entries = new Map<string, { value: string; expires_at: number }>()
  const redis = {
    async set(key: string, value: string, _option: string, seconds: number, ...flags: string[]) {
      if (state.fail_tokens && key.startsWith('auth_token:')) throw lib_error.service_unavailable
      if (flags.includes('NX') && (entries.get(key)?.expires_at ?? 0) > now) return null
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
    async del(...keys: string[]) {
      return keys.reduce((count, key) => count + Number(entries.delete(key)), 0)
    },
    async exists(key: string) {
      const entry = entries.get(key)
      return entry && entry.expires_at > now ? 1 : 0
    },
    async incr(key: string) {
      const entry = entries.get(key)
      const value = Number(entry && entry.expires_at > now ? entry.value : 0) + 1
      entries.set(key, { value: String(value), expires_at: entry?.expires_at ?? Infinity })
      return value
    },
    async expire(key: string, seconds: number) {
      const entry = entries.get(key)
      if (!entry) return 0
      entry.expires_at = now + seconds
      return 1
    },
  } as unknown as RedisClient
  const email_spy = spyOn(service_email, 'create').mockResolvedValue({ message_id: 'test-message' })
  const notification_spy = spyOn(service_email, 'create_notification').mockResolvedValue({ message_id: 'notification' })
  const database = { main_db } as unknown as ReturnType<typeof create_database_client>
  const app = new Elysia().decorate('database', database).decorate('redis', redis).use(lib_middleware_error).use(controller_auth).compile()
  const protected_app = new Elysia().decorate('database', database).use(lib_middleware_error).use(lib_jwt).get('/session-check', ({ payload }) => payload).compile()
  const id = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
  const body = {
    user_username: `user_${id}`, user_email: `${id}@example.com`, user_password: 'Test-password-123!',
    user_first_name: ' Test ', user_last_name: ' User ', user_language: 'en',
  }

  function request(path = '/auth/register', data: unknown = body) {
    return app.handle(new Request(`http://untrusted-host.example${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
    }))
  }

  function refresh(cookie?: string) {
    return app.handle(new Request('http://localhost/auth/refresh', { method: 'POST', headers: cookie ? { cookie } : {} }))
  }

  function login(user_identifier = body.user_email, user_password = body.user_password) {
    return request('/auth/login', { user_identifier, user_password })
  }

  function access(token: string) {
    return protected_app.handle(new Request('http://localhost/session-check', { headers: { authorization: `Bearer ${token}` } }))
  }

  return { app, database, request, refresh, login, access, body, email_spy, notification_spy, entries, redis, state, advance: (seconds: number) => { now += seconds } }
}

describe('POST /auth/register with email verification', () => {
  test('creates an unverified account and emails a working token without creating a session', async () => {
    const { request, body, email_spy, entries } = create_fixture()
    const response = await request('/auth/register', { ...body, user_username: body.user_username.toUpperCase(), user_email: body.user_email.toUpperCase() })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { verification_sent: true, expires_in: 86400 } })
    expect(response.headers.get('set-cookie')).toBeNull()
    const user = await main_db.user.findFirstOrThrow({ where: { user_email: body.user_email, deleted_at: null } })
    expect(user.user_username).toBe(body.user_username)
    expect(user.user_first_name).toBe('Test')
    expect(user.user_last_name).toBe('User')
    expect(user.user_email_verified_at).toBeNull()
    expect(user.user_password_hash).not.toBe(body.user_password)
    expect(await Bun.password.verify(body.user_password, user.user_password_hash!)).toBe(true)
    expect(email_spy).toHaveBeenCalledTimes(1)
    const message = email_spy.mock.calls[0]![0]
    const link = new URL(message.link)
    expect(message).toMatchObject({ user_email: body.user_email, purpose: 'email_verification', expires_in: 86400 })
    expect(link.origin).toBe('http://localhost:3100')
    expect(link.pathname).toBe('/auth/verify-email')
    expect(link.searchParams.get('token')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect([...entries.keys()].some((key) => key.startsWith('auth_refresh'))).toBe(false)

    const verified = await request('/auth/email/verify', { token: link.searchParams.get('token') })
    expect(verified.status).toBe(200)
    expect(await verified.json()).toEqual({ data: { email_verified: true } })
  })

  test.each(['username', 'email'])('rejects an existing %s without sending another email', async (field) => {
    const { request, body, email_spy } = create_fixture()
    await request()
    const response = await request('/auth/register', {
      ...body,
      ...(field === 'email' ? { user_username: `${body.user_username}_2` } : { user_email: `other-${body.user_email}` }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ code: field === 'email' ? 'user-email-exist' : 'user-username-exist' })
    expect(email_spy).toHaveBeenCalledTimes(1)
  })

  test('invalidates the token and soft-deletes the new account on SMTP failure, then allows retry after the cooldown', async () => {
    const { request, body, email_spy, advance } = create_fixture()
    email_spy.mockRejectedValueOnce(lib_error.email_unavailable)
    const response = await request()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ code: 'email-unavailable' })
    expect(await main_db.user.count({ where: { user_email: body.user_email, deleted_at: null } })).toBe(0)
    const token = new URL(email_spy.mock.calls[0]![0].link).searchParams.get('token')
    expect((await request('/auth/email/verify', { token })).status).toBe(401)
    expect((await request()).status).toBe(429)

    advance(60)
    expect((await request()).status).toBe(200)
    expect(await main_db.user.count({ where: { user_email: body.user_email, deleted_at: null } })).toBe(1)
  })

  test('soft-deletes the new account when verification token storage fails', async () => {
    const { request, body, email_spy, state } = create_fixture()
    state.fail_tokens = true
    const response = await request()

    expect(response.status).toBe(503)
    expect(email_spy).not.toHaveBeenCalled()
    expect(await main_db.user.count({ where: { user_email: body.user_email, deleted_at: null } })).toBe(0)
  })

  test('allows only one concurrent registration and email for an address', async () => {
    const { request, body, email_spy } = create_fixture()
    const responses = await Promise.all([request(), request()])

    expect(responses.map((response) => response.status).sort()).toEqual([200, 429])
    expect(email_spy).toHaveBeenCalledTimes(1)
    expect(await main_db.user.count({ where: { user_email: body.user_email, deleted_at: null } })).toBe(1)
  })

  test.each(['', 'invalid-url', 'javascript:alert(1)'])('rejects invalid application URL %j before account creation', async (value) => {
    process.env.PUBLIC_APP_URL = value
    const { request, body, email_spy } = create_fixture()
    const response = await request()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ code: 'email-unavailable' })
    expect(email_spy).not.toHaveBeenCalled()
    expect(await main_db.user.count({ where: { user_email: body.user_email } })).toBe(0)
  })

  test('requires HTTPS outside development', async () => {
    process.env.ENV = 'production'
    const { request, body } = create_fixture()
    expect((await request()).status).toBe(503)
    expect(await main_db.user.count({ where: { user_email: body.user_email } })).toBe(0)
  })

  test('supports a configured production HTTPS origin', async () => {
    process.env.ENV = 'production'
    process.env.PUBLIC_APP_URL = 'https://mawiid.example'
    const { request, email_spy } = create_fixture()
    expect((await request()).status).toBe(200)
    expect(new URL(email_spy.mock.calls[0]![0].link).origin).toBe('https://mawiid.example')
  })

  test('rejects malformed input without creating an account or sending mail', async () => {
    const { request, body, email_spy } = create_fixture()
    const response = await request('/auth/register', { ...body, user_password: 'short' })
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      code: 'validation-error',
      message: 'Please check the information you entered.',
      errors: [{ field: 'user_password', message: 'Password must contain 8–128 characters.' }],
    })
    expect(email_spy).not.toHaveBeenCalled()
    expect(await main_db.user.count({ where: { user_email: body.user_email } })).toBe(0)
  })
})

describe('POST /auth/email/resend', () => {
  const response_body = { data: { message: 'If your account needs verification, an email will arrive shortly.' } }

  test('shares the signup cooldown, replaces the original link, and sends a verifiable token', async () => {
    const { request, body, email_spy, advance } = create_fixture()
    await request()
    const previous = new URL(email_spy.mock.calls[0]![0].link).searchParams.get('token')
    const resend_body = { user_email: body.user_email.toUpperCase() }
    const limited = await request('/auth/email/resend', resend_body)
    expect(limited.status).toBe(429)
    expect(email_spy).toHaveBeenCalledTimes(1)

    advance(60)
    const response = await request('/auth/email/resend', resend_body)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(response_body)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(email_spy).toHaveBeenCalledTimes(2)
    const message = email_spy.mock.calls[1]![0]
    const link = new URL(message.link)
    expect(message).toMatchObject({ user_email: body.user_email, purpose: 'email_verification', expires_in: 86400 })
    expect(link.origin).toBe('http://localhost:3100')
    expect(link.searchParams.get('token')).not.toBe(previous)
    expect((await request('/auth/email/verify', { token: previous })).status).toBe(401)
    expect((await request('/auth/email/verify', { token: link.searchParams.get('token') })).status).toBe(200)
    expect(await main_db.user.count({ where: { user_email: body.user_email, deleted_at: null } })).toBe(1)
  })

  test.each(['unknown', 'verified', 'deleted'])('uses the same response and cooldown for a %s address without sending mail', async (state) => {
    const { request, body, email_spy } = create_fixture()
    if (state !== 'unknown') await main_db.user.create({ data: {
      user_email: body.user_email, user_first_name: 'Test', user_last_name: 'User',
      ...(state === 'verified' ? { user_email_verified_at: new Date() } : { deleted_at: new Date() }),
    } })
    const response = await request('/auth/email/resend', { user_email: body.user_email })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(response_body)
    expect(email_spy).not.toHaveBeenCalled()
    expect((await request('/auth/email/resend', { user_email: body.user_email })).status).toBe(429)
  })

  test('invalidates a failed delivery token without deleting the account and permits a later retry', async () => {
    const { request, body, email_spy, advance } = create_fixture()
    await request()
    const previous = new URL(email_spy.mock.calls[0]![0].link).searchParams.get('token')
    advance(60)
    email_spy.mockRejectedValueOnce(lib_error.email_unavailable)
    const response = await request('/auth/email/resend', { user_email: body.user_email })
    const failed = new URL(email_spy.mock.calls[1]![0].link).searchParams.get('token')

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ code: 'email-unavailable' })
    expect(await main_db.user.count({ where: { user_email: body.user_email, deleted_at: null } })).toBe(1)
    expect((await request('/auth/email/verify', { token: previous })).status).toBe(401)
    expect((await request('/auth/email/verify', { token: failed })).status).toBe(401)
    expect((await request('/auth/email/resend', { user_email: body.user_email })).status).toBe(429)

    advance(60)
    expect((await request('/auth/email/resend', { user_email: body.user_email })).status).toBe(200)
    const latest = new URL(email_spy.mock.calls[2]![0].link).searchParams.get('token')
    expect((await request('/auth/email/verify', { token: latest })).status).toBe(200)
  })

  test('keeps the account and original link when storing the replacement token fails', async () => {
    const { request, body, email_spy, state, advance } = create_fixture()
    await request()
    const previous = new URL(email_spy.mock.calls[0]![0].link).searchParams.get('token')
    advance(60)
    state.fail_tokens = true
    expect((await request('/auth/email/resend', { user_email: body.user_email })).status).toBe(503)
    expect(email_spy).toHaveBeenCalledTimes(1)
    expect(await main_db.user.count({ where: { user_email: body.user_email, deleted_at: null } })).toBe(1)
    expect((await request('/auth/email/verify', { token: previous })).status).toBe(200)
  })

  test('sends only one email for concurrent resend requests', async () => {
    const { request, body, email_spy, advance } = create_fixture()
    await request()
    advance(60)
    const responses = await Promise.all([
      request('/auth/email/resend', { user_email: body.user_email }),
      request('/auth/email/resend', { user_email: body.user_email }),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 429])
    expect(email_spy).toHaveBeenCalledTimes(2)
  })

  test('issues a usable new link after the original one expires', async () => {
    const { request, body, email_spy, advance } = create_fixture()
    await request()
    advance(86400)
    expect((await request('/auth/email/resend', { user_email: body.user_email })).status).toBe(200)
    const token = new URL(email_spy.mock.calls[1]![0].link).searchParams.get('token')
    expect((await request('/auth/email/verify', { token })).status).toBe(200)
  })

  test.each([{}, { user_email: 'invalid' }])('returns a readable validation error for %j', async (body) => {
    const { request, email_spy } = create_fixture()
    const response = await request('/auth/email/resend', body)
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      code: 'validation-error', message: 'Please check the information you entered.',
      errors: [{ field: 'user_email', message: 'Enter a valid email address.' }],
    })
    expect(email_spy).not.toHaveBeenCalled()
  })
})

describe('email verification enforcement', () => {
  const blocked_response = { code: 'email-not-verified', message: 'Please verify your email before signing in.' }

  test('blocks correct password login until verification without sending another email or creating a session', async () => {
    const { request, login, email_spy, entries } = create_fixture()
    await request()
    const response = await login()

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual(blocked_response)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(email_spy).toHaveBeenCalledTimes(1)
    expect([...entries.keys()].some((key) => key.startsWith('auth_refresh:') || key.startsWith('auth_refresh_family:'))).toBe(false)
  })

  test.each(['email', 'username'])('allows password login by %s after verifying the email', async (identifier) => {
    const { request, login, body, email_spy } = create_fixture()
    await request()
    const token = new URL(email_spy.mock.calls[0]![0].link).searchParams.get('token')
    expect((await request('/auth/email/verify', { token })).status).toBe(200)
    const response = await login(identifier === 'email' ? body.user_email : body.user_username)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: {
      access_token: expect.any(String), expires_in: 900,
      user: { user_email: body.user_email, user_email_verified_at: expect.any(String) },
    } })
    expect(response.headers.get('set-cookie')).toContain('__Host-mawiid_refresh=')
  })

  test.each(['unverified', 'verified', 'unknown'])('does not reveal verification status for incorrect credentials on an %s account', async (state) => {
    const { request, login, body } = create_fixture()
    if (state !== 'unknown') await request()
    if (state === 'verified') await main_db.user.updateMany({ where: { user_email: body.user_email }, data: { user_email_verified_at: new Date() } })
    const response = await login(body.user_email, 'Wrong-password-123!')

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'invalid-credentials' })
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  test('requires verification for older password accounts without an email', async () => {
    const { request, login, body } = create_fixture()
    await request()
    await main_db.user.updateMany({ where: { user_email: body.user_email }, data: { user_email: null } })
    const response = await login(body.user_username)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual(blocked_response)
  })

  test('rotates verified password sessions normally', async () => {
    const { request, login, refresh, email_spy } = create_fixture()
    await request()
    const token = new URL(email_spy.mock.calls[0]![0].link).searchParams.get('token')
    await request('/auth/email/verify', { token })
    const signed_in = await login()
    const cookie = signed_in.headers.get('set-cookie')!.split(';')[0]!
    const response = await refresh(cookie)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { access_token: expect.any(String), user: { user_email_verified_at: expect.any(String) } } })
    expect(response.headers.get('set-cookie')!.split(';')[0]).not.toBe(cookie)
    expect((await refresh(cookie)).status).toBe(401)
  })

  test('rejects a legacy unverified refresh session, revokes its family and clears its cookie', async () => {
    const { request, login, refresh, body, email_spy, entries } = create_fixture()
    await request()
    const user = await main_db.user.findFirstOrThrow({ where: { user_email: body.user_email } })
    const token = 'legacy-refresh-token'
    const family = `legacy-${user.user_id}`
    const hash = new Bun.CryptoHasher('sha256').update(token).digest('hex')
    entries.set(`auth_refresh:${hash}`, { value: `${user.user_id}:${family}`, expires_at: Infinity })
    entries.set(`auth_refresh_family:${family}`, { value: String(user.user_id), expires_at: Infinity })
    const cookie = `__Host-mawiid_refresh=${token}`
    const response = await refresh(cookie)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual(blocked_response)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(entries.has(`auth_refresh_family:${family}`)).toBe(false)
    expect(entries.has(`auth_refresh:${hash}`)).toBe(false)

    const verification = new URL(email_spy.mock.calls[0]![0].link).searchParams.get('token')
    expect((await request('/auth/email/verify', { token: verification })).status).toBe(200)
    expect((await refresh(cookie)).status).toBe(401)
    expect((await login()).status).toBe(200)
  })

  test('rechecks current verification status at refresh time', async () => {
    const { request, login, refresh, body } = create_fixture()
    await request()
    await main_db.user.updateMany({ where: { user_email: body.user_email }, data: { user_email_verified_at: new Date() } })
    const signed_in = await login()
    const cookie = signed_in.headers.get('set-cookie')!.split(';')[0]!
    await main_db.user.updateMany({ where: { user_email: body.user_email }, data: { user_email_verified_at: null } })
    const response = await refresh(cookie)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual(blocked_response)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  test('allows phone-only OTP login and refresh without an email', async () => {
    const { request, refresh, entries } = create_fixture()
    const phone = '+15550000123'
    await main_db.user.create({ data: { user_phone: phone, user_first_name: 'Phone', user_last_name: 'User' } })
    entries.set(`auth_otp:${phone}`, { value: new Bun.CryptoHasher('sha256').update('123456').digest('hex'), expires_at: 300 })
    const response = await request('/auth/otp/login', { user_phone: phone, otp_code: '123456' })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { access_token: expect.any(String), user: { user_email: null, user_email_verified_at: null } } })
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!
    expect((await refresh(cookie)).status).toBe(200)
  })

  test('cannot bypass the password-account email requirement by using phone OTP', async () => {
    const { request, body, entries } = create_fixture()
    await request()
    const phone = '+15550000456'
    await main_db.user.updateMany({ where: { user_email: body.user_email }, data: { user_phone: phone } })
    entries.set(`auth_otp:${phone}`, { value: new Bun.CryptoHasher('sha256').update('123456').digest('hex'), expires_at: 300 })
    const response = await request('/auth/otp/login', { user_phone: phone, otp_code: '123456' })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual(blocked_response)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  test('still rejects a missing refresh token and clears its cookie', async () => {
    const { refresh } = create_fixture()
    const response = await refresh()
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'invalid-token' })
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})

describe('POST /auth/password/forgot', () => {
  const response_body = { data: { message: 'If your account is eligible, a password reset link will arrive shortly.' } }

  async function verified_fixture() {
    const fixture = create_fixture()
    expect((await fixture.request()).status).toBe(200)
    const token = new URL(fixture.email_spy.mock.calls[0]![0].link).searchParams.get('token')
    expect((await fixture.request('/auth/email/verify', { token })).status).toBe(200)
    return fixture
  }

  test('emails a 30-minute reset link without changing the password or current sessions', async () => {
    const { request, login, refresh, body, email_spy, redis } = await verified_fixture()
    const before = await main_db.user.findFirstOrThrow({ where: { user_email: body.user_email } })
    const signed_in = await login()
    const cookie = signed_in.headers.get('set-cookie')!.split(';')[0]!
    const response = await request('/auth/password/forgot', { user_email: body.user_email.toUpperCase() })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(response_body)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(email_spy).toHaveBeenCalledTimes(2)
    const message = email_spy.mock.calls[1]![0]
    const link = new URL(message.link)
    expect(message).toMatchObject({ user_email: body.user_email, purpose: 'password_reset', expires_in: 1800 })
    expect(link.origin).toBe('http://localhost:3100')
    expect(link.pathname).toBe('/auth/reset-password')
    const token = link.searchParams.get('token')!
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect((await request('/auth/email/verify', { token })).status).toBe(401)
    expect(await service_auth_token.delete(token, 'password_reset', redis)).toEqual({ user_id: before.user_id, user_email: body.user_email, user_session_version: 0 })
    expect(await main_db.user.findFirstOrThrow({ where: { user_id: before.user_id } })).toEqual(before)
    expect((await refresh(cookie)).status).toBe(200)
    expect((await login()).status).toBe(200)
  })

  test.each(['unknown', 'unverified', 'deleted', 'phone_only'])('returns the same confirmation and cooldown for a %s account without sending a reset email', async (state) => {
    const { request, body, email_spy } = create_fixture()
    if (state === 'unverified' || state === 'deleted') await request()
    if (state === 'deleted') await main_db.user.updateMany({ where: { user_email: body.user_email }, data: { deleted_at: new Date(), user_email_verified_at: new Date() } })
    if (state === 'phone_only') await main_db.user.create({ data: {
      user_email: body.user_email, user_phone: '+15550000789', user_first_name: 'Phone', user_last_name: 'User', user_email_verified_at: new Date(),
    } })
    email_spy.mockClear()
    const response = await request('/auth/password/forgot', { user_email: body.user_email })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(response_body)
    expect(email_spy).not.toHaveBeenCalled()
    expect((await request('/auth/password/forgot', { user_email: body.user_email.toUpperCase() })).status).toBe(429)
  })

  test('does not replace an unverified account verification link', async () => {
    const { request, body, email_spy } = create_fixture()
    await request()
    const token = new URL(email_spy.mock.calls[0]![0].link).searchParams.get('token')
    expect((await request('/auth/password/forgot', { user_email: body.user_email })).status).toBe(200)
    expect((await request('/auth/email/verify', { token })).status).toBe(200)
  })

  test('replaces the previous reset link after the cooldown', async () => {
    const { request, body, email_spy, redis, advance } = await verified_fixture()
    expect((await request('/auth/password/forgot', { user_email: body.user_email })).status).toBe(200)
    const first = new URL(email_spy.mock.calls[1]![0].link).searchParams.get('token')!
    expect((await request('/auth/password/forgot', { user_email: body.user_email })).status).toBe(429)
    advance(60)
    expect((await request('/auth/password/forgot', { user_email: body.user_email })).status).toBe(200)
    const latest = new URL(email_spy.mock.calls[2]![0].link).searchParams.get('token')!

    expect(first).not.toBe(latest)
    await expect(service_auth_token.delete(first, 'password_reset', redis)).rejects.toEqual(lib_error.invalid_token)
    expect(await service_auth_token.delete(latest, 'password_reset', redis)).toMatchObject({ user_email: body.user_email })
  })

  test('expires the reset token after 30 minutes', async () => {
    const { request, body, email_spy, redis, advance } = await verified_fixture()
    await request('/auth/password/forgot', { user_email: body.user_email })
    const token = new URL(email_spy.mock.calls[1]![0].link).searchParams.get('token')!
    advance(1800)
    await expect(service_auth_token.delete(token, 'password_reset', redis)).rejects.toEqual(lib_error.invalid_token)
  })

  test('invalidates a failed email token while preserving the account and allows a later retry', async () => {
    const { request, body, email_spy, redis, advance } = await verified_fixture()
    const before = await main_db.user.findFirstOrThrow({ where: { user_email: body.user_email } })
    email_spy.mockRejectedValueOnce(lib_error.email_unavailable)
    const response = await request('/auth/password/forgot', { user_email: body.user_email })
    const token = new URL(email_spy.mock.calls[1]![0].link).searchParams.get('token')!

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ code: 'email-unavailable' })
    await expect(service_auth_token.delete(token, 'password_reset', redis)).rejects.toEqual(lib_error.invalid_token)
    expect(await main_db.user.findFirstOrThrow({ where: { user_id: before.user_id } })).toEqual(before)
    expect((await request('/auth/password/forgot', { user_email: body.user_email })).status).toBe(429)
    advance(60)
    expect((await request('/auth/password/forgot', { user_email: body.user_email })).status).toBe(200)
  })

  test('does not send an email or change the account when token storage fails', async () => {
    const { request, body, email_spy, state } = await verified_fixture()
    const before = await main_db.user.findFirstOrThrow({ where: { user_email: body.user_email } })
    email_spy.mockClear()
    state.fail_tokens = true
    expect((await request('/auth/password/forgot', { user_email: body.user_email })).status).toBe(503)
    expect(email_spy).not.toHaveBeenCalled()
    expect(await main_db.user.findFirstOrThrow({ where: { user_id: before.user_id } })).toEqual(before)
  })

  test('sends one reset email for concurrent requests', async () => {
    const { request, body, email_spy } = await verified_fixture()
    const responses = await Promise.all([
      request('/auth/password/forgot', { user_email: body.user_email }),
      request('/auth/password/forgot', { user_email: body.user_email }),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 429])
    expect(email_spy).toHaveBeenCalledTimes(2)
  })

  test.each([{}, { user_email: 'invalid' }])('returns a readable validation error for %j', async (body) => {
    const { request, email_spy } = create_fixture()
    const response = await request('/auth/password/forgot', body)
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      code: 'validation-error', message: 'Please check the information you entered.',
      errors: [{ field: 'user_email', message: 'Enter a valid email address.' }],
    })
    expect(email_spy).not.toHaveBeenCalled()
  })
})

describe('POST /auth/password/reset', () => {
  const new_password = 'New-password-456!'

  async function reset_fixture() {
    const fixture = create_fixture()
    await fixture.request()
    const verification = new URL(fixture.email_spy.mock.calls[0]![0].link).searchParams.get('token')
    expect((await fixture.request('/auth/email/verify', { token: verification })).status).toBe(200)
    expect((await fixture.request('/auth/password/forgot', { user_email: fixture.body.user_email })).status).toBe(200)
    const token = new URL(fixture.email_spy.mock.calls[1]![0].link).searchParams.get('token')!
    const user = await main_db.user.findFirstOrThrow({ where: { user_email: fixture.body.user_email } })
    return { ...fixture, token, user }
  }

  test('changes the password, invalidates multiple sessions immediately, sends a notification and does not sign in', async () => {
    const { request, login, refresh, access, token, user, body, notification_spy } = await reset_fixture()
    const first = await login()
    const second = await login()
    const first_session = await first.json() as { data: { access_token: string } }
    const second_session = await second.json() as { data: { access_token: string } }
    const cookies = [first, second].map((response) => response.headers.get('set-cookie')!.split(';')[0]!)
    expect((await access(first_session.data.access_token)).status).toBe(200)
    const response = await request('/auth/password/reset', { token, user_password: new_password })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { password_reset: true, notification_sent: true } })
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    const updated = await main_db.user.findUniqueOrThrow({ where: { user_id: user.user_id } })
    expect(updated.user_session_version).toBe(1)
    expect(updated.user_password_hash).not.toBe(new_password)
    expect(await Bun.password.verify(new_password, updated.user_password_hash!)).toBe(true)
    expect((await access(first_session.data.access_token)).status).toBe(401)
    expect((await access(second_session.data.access_token)).status).toBe(401)
    for (const cookie of cookies) expect((await refresh(cookie)).status).toBe(401)
    expect((await login(body.user_email, body.user_password)).status).toBe(401)
    const signed_in = await login(body.user_email, new_password)
    expect(signed_in.status).toBe(200)
    const new_session = await signed_in.json() as { data: { access_token: string } }
    expect((await access(new_session.data.access_token)).status).toBe(200)
    expect(notification_spy).toHaveBeenCalledWith(body.user_email)
  })

  test('consumes the token once, including concurrent submissions', async () => {
    const { request, token, notification_spy } = await reset_fixture()
    const responses = await Promise.all([
      request('/auth/password/reset', { token, user_password: new_password }),
      request('/auth/password/reset', { token, user_password: new_password }),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 401])
    expect((await request('/auth/password/reset', { token, user_password: new_password })).status).toBe(401)
    expect(notification_spy).toHaveBeenCalledTimes(1)
  })

  test('keeps the token usable after a password validation failure', async () => {
    const { request, token } = await reset_fixture()
    const response = await request('/auth/password/reset', { token, user_password: '123' })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'validation-error', errors: [{ field: 'user_password', message: 'Password must contain 8–128 characters.' }] })
    expect((await request('/auth/password/reset', { token, user_password: new_password })).status).toBe(200)
  })

  test.each(['expired', 'unknown', 'changed_email', 'deleted', 'unverified', 'stale_version'])('rejects a %s reset token without changing the password', async (state) => {
    const { request, token, user, advance, notification_spy } = await reset_fixture()
    if (state === 'expired') advance(1800)
    if (state === 'changed_email') await main_db.user.update({ where: { user_id: user.user_id }, data: { user_email: `${crypto.randomUUID()}@example.com` } })
    if (state === 'deleted') await main_db.user.update({ where: { user_id: user.user_id }, data: { deleted_at: new Date() } })
    if (state === 'unverified') await main_db.user.update({ where: { user_id: user.user_id }, data: { user_email_verified_at: null } })
    if (state === 'stale_version') await main_db.user.update({ where: { user_id: user.user_id }, data: { user_session_version: 1 } })
    const response = await request('/auth/password/reset', { token: state === 'unknown' ? 'a'.repeat(43) : token, user_password: new_password })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'invalid-token' })
    expect((await main_db.user.findUniqueOrThrow({ where: { user_id: user.user_id } })).user_password_hash).toBe(user.user_password_hash)
    expect(notification_spy).not.toHaveBeenCalled()
  })

  test('cannot consume an email verification token for a password reset', async () => {
    const { request, email_spy } = create_fixture()
    await request()
    const token = new URL(email_spy.mock.calls[0]![0].link).searchParams.get('token')
    expect((await request('/auth/password/reset', { token, user_password: new_password })).status).toBe(401)
    expect((await request('/auth/email/verify', { token })).status).toBe(200)
  })

  test('reports a completed password change if the confirmation email fails', async () => {
    const { request, login, body, token, notification_spy } = await reset_fixture()
    notification_spy.mockRejectedValueOnce(lib_error.email_unavailable)
    const error_spy = spyOn(console, 'error').mockImplementation(() => {})
    const response = await request('/auth/password/reset', { token, user_password: new_password })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { password_reset: true, notification_sent: false } })
    expect((await login(body.user_email, new_password)).status).toBe(200)
    expect(error_spy).toHaveBeenCalledWith('Password reset succeeded, but the confirmation email could not be sent.')
  })

  test('supports pre-upgrade links and sessions only until the first reset', async () => {
    const { request, access, refresh, redis, entries, user, body } = await reset_fixture()
    const legacy_access = await lib_jwt_sign.decorator.lib_jwt_signer.sign({ user_id: user.user_id })
    const legacy_refresh = 'legacy-reset-refresh'
    const hash = new Bun.CryptoHasher('sha256').update(legacy_refresh).digest('hex')
    entries.set(`auth_refresh:${hash}`, { value: `${user.user_id}:legacy-family`, expires_at: Infinity })
    entries.set('auth_refresh_family:legacy-family', { value: String(user.user_id), expires_at: Infinity })
    const legacy_token = await service_auth_token.create({ user_id: user.user_id, user_email: body.user_email }, 'password_reset', redis)
    expect((await access(legacy_access)).status).toBe(200)
    expect((await request('/auth/password/reset', { token: legacy_token.token, user_password: new_password })).status).toBe(200)
    expect((await access(legacy_access)).status).toBe(401)
    expect((await refresh(`__Host-mawiid_refresh=${legacy_refresh}`)).status).toBe(401)
  })

  test('cannot change the password when the stored password changes during reset', async () => {
    const { request, token, user, notification_spy } = await reset_fixture()
    const hash_password = Bun.password.hash
    spyOn(Bun.password, 'hash').mockImplementation(async () => {
      await main_db.user.update({ where: { user_id: user.user_id }, data: { user_password_hash: 'concurrent-password-change', user_session_version: { increment: 1 } } })
      return hash_password(new_password, { algorithm: 'argon2id', memoryCost: 19456, timeCost: 2 })
    })
    expect((await request('/auth/password/reset', { token, user_password: new_password })).status).toBe(401)
    expect((await main_db.user.findUniqueOrThrow({ where: { user_id: user.user_id } })).user_password_hash).toBe('concurrent-password-change')
    expect(notification_spy).not.toHaveBeenCalled()
  })

  test('clears previous failed-login limits after recovery', async () => {
    const { request, login, token, body, entries } = await reset_fixture()
    for (const identifier of [body.user_email, body.user_username]) {
      const hash = new Bun.CryptoHasher('sha256').update(identifier).digest('hex')
      entries.set(`auth_login_attempt:${hash}`, { value: '10', expires_at: 900 })
      expect((await login(identifier)).status).toBe(429)
    }
    expect((await request('/auth/password/reset', { token, user_password: new_password })).status).toBe(200)
    expect((await login(body.user_email, new_password)).status).toBe(200)
    expect((await login(body.user_username, new_password)).status).toBe(200)
  })

  test('does not revoke another user sessions', async () => {
    const { request, access, refresh, token, user, body } = await reset_fixture()
    const other_email = `${crypto.randomUUID()}@example.com`
    await main_db.user.create({ data: {
      user_email: other_email, user_first_name: 'Other', user_last_name: 'User',
      user_password_hash: user.user_password_hash, user_email_verified_at: new Date(),
    } })
    const other_login = await request('/auth/login', { user_identifier: other_email, user_password: body.user_password })
    const session = await other_login.json() as { data: { access_token: string } }
    const cookie = other_login.headers.get('set-cookie')!.split(';')[0]!
    expect((await request('/auth/password/reset', { token, user_password: new_password })).status).toBe(200)
    expect((await access(session.data.access_token)).status).toBe(200)
    expect((await refresh(cookie)).status).toBe(200)
  })
})
