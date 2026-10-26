import type { RedisClient } from 'bun'
import type { Static } from 'elysia'
import type { create_database_client } from '@db/client.db'
import { lib_error } from '@lib/error.lib'
import { lib_jwt_access_ttl_seconds, type lib_jwt_signer } from '@lib/jwt.lib'
import { dto_auth } from '@module/main/auth/auth.dto'

const otp_ttl_seconds = 5 * 60
const otp_cooldown_seconds = 60
const otp_max_attempts = 5
const login_max_attempts = 10
const login_attempt_window_seconds = 15 * 60
const refresh_reuse_grace_seconds = 30
const password_option = { algorithm: 'argon2id', memoryCost: 19456, timeCost: 2 } as const
const dummy_password_hash = Bun.password.hash(crypto.randomUUID(), password_option)

export const service_auth_refresh_ttl_seconds = 30 * 24 * 60 * 60

type auth_database = ReturnType<typeof create_database_client>
type auth_user = Static<typeof dto_auth.login.response>['data']['user']
type auth_session = { body: Static<typeof dto_auth.login.response>; refresh_token: string }

function otp_key(user_phone: string) {
  return `auth_otp:${user_phone}`
}

function otp_attempt_key(user_phone: string) {
  return `auth_otp_attempt:${user_phone}`
}

function otp_cooldown_key(user_phone: string) {
  return `auth_otp_cooldown:${user_phone}`
}

function login_attempt_key(user_identifier: string) {
  return `auth_login_attempt:${hash(user_identifier)}`
}

function refresh_key(refresh_token: string) {
  return `auth_refresh:${hash(refresh_token)}`
}

function refresh_used_key(refresh_token: string) {
  return `auth_refresh_used:${hash(refresh_token)}`
}

function refresh_family_key(family: string) {
  return `auth_refresh_family:${family}`
}

function hash(value: string) {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}

function normalize(value: string) {
  return value.trim().toLowerCase()
}

function generate_otp_code() {
  const [value] = crypto.getRandomValues(new Uint32Array(1))
  return String(value! % 1_000_000).padStart(6, '0')
}

function generate_token() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
}

function is_unique_violation(error: unknown) {
  return (error as { code?: string } | null)?.code === 'P2002'
}

function to_auth_user(user: auth_user): auth_user {
  return {
    user_id: user.user_id,
    user_phone: user.user_phone,
    user_username: user.user_username,
    user_email: user.user_email,
    user_first_name: user.user_first_name,
    user_last_name: user.user_last_name,
    user_image: user.user_image,
    user_language: user.user_language,
    created_at: user.created_at,
  }
}

async function ensure_available(user_username: string, user_email: string, database: auth_database) {
  const existing = await database.main_db.user.findFirst({
    where: { deleted_at: null, OR: [{ user_username }, { user_email }] },
    select: { user_username: true },
  })
  if (!existing) return
  throw existing.user_username === user_username ? lib_error.username_already_exist : lib_error.email_already_exist
}

async function revoke_reused(refresh_token: string, redis: RedisClient) {
  const used = await redis.get(refresh_used_key(refresh_token))
  if (!used) return
  const [family, rotated_at] = used.split(':')
  if (Date.now() - Number(rotated_at) > refresh_reuse_grace_seconds * 1000) await redis.del(refresh_family_key(family!))
}

export const service_auth = {
  async session(user: auth_user, signer: lib_jwt_signer, redis: RedisClient, family = generate_token()): Promise<auth_session> {
    const access_token = await signer.sign({ user_id: user.user_id })
    const refresh_token = generate_token()
    await redis.set(refresh_key(refresh_token), `${user.user_id}:${family}`, 'EX', service_auth_refresh_ttl_seconds)
    await redis.set(refresh_family_key(family), String(user.user_id), 'EX', service_auth_refresh_ttl_seconds)
    return {
      body: {
        data: {
          access_token,
          expires_in: lib_jwt_access_ttl_seconds,
          user: to_auth_user(user),
        },
      },
      refresh_token,
    }
  },

  async register(
    body: Static<typeof dto_auth.register.body>,
    signer: lib_jwt_signer,
    database: auth_database,
    redis: RedisClient,
  ): Promise<auth_session> {
    const user_username = normalize(body.user_username)
    const user_email = normalize(body.user_email)
    await ensure_available(user_username, user_email, database)
    const user_password_hash = await Bun.password.hash(body.user_password, password_option)
    const user = await database.main_db.user
      .create({
        data: {
          user_username,
          user_email,
          user_password_hash,
          user_first_name: body.user_first_name.trim(),
          user_last_name: body.user_last_name.trim(),
          user_language: body.user_language ?? 'en',
        },
      })
      .catch(async (error) => {
        if (is_unique_violation(error)) await ensure_available(user_username, user_email, database)
        throw error
      })
    return await service_auth.session(user, signer, redis)
  },

  async login(
    body: Static<typeof dto_auth.login.body>,
    signer: lib_jwt_signer,
    database: auth_database,
    redis: RedisClient,
  ): Promise<auth_session> {
    const user_identifier = normalize(body.user_identifier)
    const attempt_key = login_attempt_key(user_identifier)
    if (Number(await redis.get(attempt_key)) >= login_max_attempts) throw lib_error.too_many_requests
    const user = await database.main_db.user.findFirst({
      where: user_identifier.includes('@')
        ? { user_email: user_identifier, deleted_at: null }
        : { user_username: user_identifier, deleted_at: null },
    })
    const valid = await Bun.password.verify(body.user_password, user?.user_password_hash ?? (await dummy_password_hash))
    if (!user?.user_password_hash || !valid) {
      const attempts = await redis.incr(attempt_key)
      if (attempts === 1) await redis.expire(attempt_key, login_attempt_window_seconds)
      throw lib_error.invalid_credentials
    }
    await redis.del(attempt_key)
    return await service_auth.session(user, signer, redis)
  },

  async otp(
    body: Static<typeof dto_auth.otp.body>,
    redis: RedisClient,
  ): Promise<Static<typeof dto_auth.otp.response>> {
    if (process.env.ENV !== 'dev') throw lib_error.service_unavailable
    const allowed = await redis.set(otp_cooldown_key(body.user_phone), '1', 'EX', String(otp_cooldown_seconds), 'NX')
    if (!allowed) throw lib_error.too_many_requests
    const otp_code = generate_otp_code()
    await redis.set(otp_key(body.user_phone), hash(otp_code), 'EX', otp_ttl_seconds)
    await redis.del(otp_attempt_key(body.user_phone))
    console.log(`[auth] otp code for ${body.user_phone}: ${otp_code}`)
    return { data: { expires_in: otp_ttl_seconds, otp_code } }
  },

  async verify(user_phone: string, otp_code: string, redis: RedisClient, consume = true) {
    const stored = await redis.get(otp_key(user_phone))
    if (!stored) throw lib_error.code_expired
    if (stored !== hash(otp_code)) {
      const attempts = await redis.incr(otp_attempt_key(user_phone))
      await redis.expire(otp_attempt_key(user_phone), otp_ttl_seconds)
      if (attempts >= otp_max_attempts) await redis.del(otp_key(user_phone), otp_attempt_key(user_phone))
      throw lib_error.invalid_otp_code
    }
    if (!consume) return
    const consumed = await redis.getdel(otp_key(user_phone))
    if (!consumed) throw lib_error.code_expired
    await redis.del(otp_attempt_key(user_phone))
  },

  async otp_login(
    body: Static<typeof dto_auth.otp_login.body>,
    signer: lib_jwt_signer,
    database: auth_database,
    redis: RedisClient,
  ): Promise<auth_session> {
    const user = await database.main_db.user.findFirst({ where: { user_phone: body.user_phone, deleted_at: null } })
    await service_auth.verify(body.user_phone, body.otp_code, redis, Boolean(user))
    if (!user) throw lib_error.user_not_found
    return await service_auth.session(user, signer, redis)
  },

  async otp_register(
    body: Static<typeof dto_auth.otp_register.body>,
    signer: lib_jwt_signer,
    database: auth_database,
    redis: RedisClient,
  ): Promise<auth_session> {
    await service_auth.verify(body.user_phone, body.otp_code, redis)
    const existing = await database.main_db.user.findFirst({ where: { user_phone: body.user_phone, deleted_at: null } })
    if (existing) throw lib_error.phone_already_exist
    const user = await database.main_db.user.create({
      data: {
        user_phone: body.user_phone,
        user_first_name: body.user_first_name.trim(),
        user_last_name: body.user_last_name.trim(),
        user_language: body.user_language ?? 'en',
      },
    })
    return await service_auth.session(user, signer, redis)
  },

  async refresh(
    refresh_token: string | undefined,
    signer: lib_jwt_signer,
    database: auth_database,
    redis: RedisClient,
  ): Promise<auth_session> {
    if (!refresh_token) throw lib_error.invalid_token
    const stored = await redis.getdel(refresh_key(refresh_token))
    if (!stored) {
      await revoke_reused(refresh_token, redis)
      throw lib_error.invalid_token
    }
    const [user_id_value, family] = stored.split(':')
    await redis.set(refresh_used_key(refresh_token), `${family}:${Date.now()}`, 'EX', service_auth_refresh_ttl_seconds)
    if (!family || !(await redis.exists(refresh_family_key(family)))) throw lib_error.invalid_token
    const user = await database.main_db.user.findFirst({ where: { user_id: Number(user_id_value), deleted_at: null } })
    if (!user) throw lib_error.invalid_token
    return await service_auth.session(user, signer, redis, family)
  },

  async logout(refresh_token: string | undefined, redis: RedisClient): Promise<Static<typeof dto_auth.logout.response>> {
    const stored = refresh_token ? await redis.getdel(refresh_key(refresh_token)) : null
    const family = stored?.split(':')[1]
    if (family) await redis.del(refresh_family_key(family))
    return { data: { logged_out: true } }
  },
}
