import type { RedisClient } from 'bun'
import type { Static } from 'elysia'
import type { create_database_client } from '@db/client.db'
import { lib_error } from '@lib/error.lib'
import { lib_jwt_access_ttl_seconds, type lib_jwt_signer } from '@lib/jwt.lib'
import { dto_auth } from '@module/main/auth/auth.dto'

const otp_ttl_seconds = 5 * 60
const otp_cooldown_seconds = 60
const otp_max_attempts = 5
const refresh_ttl_seconds = 30 * 24 * 60 * 60

type auth_user = Static<typeof dto_auth.login.response>['data']['user']

function otp_key(user_phone: string) {
  return `auth_otp:${user_phone}`
}

function otp_attempt_key(user_phone: string) {
  return `auth_otp_attempt:${user_phone}`
}

function otp_cooldown_key(user_phone: string) {
  return `auth_otp_cooldown:${user_phone}`
}

function refresh_key(refresh_token: string) {
  return `auth_refresh:${refresh_token}`
}

function hash(value: string) {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}

function generate_otp_code() {
  const [value] = crypto.getRandomValues(new Uint32Array(1))
  return String(value! % 1_000_000).padStart(6, '0')
}

function generate_refresh_token() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
}

function to_auth_user(user: auth_user): auth_user {
  return {
    user_id: user.user_id,
    user_phone: user.user_phone,
    user_first_name: user.user_first_name,
    user_last_name: user.user_last_name,
    user_image: user.user_image,
    user_language: user.user_language,
    created_at: user.created_at,
  }
}

export const service_auth = {
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

  async session(
    user: auth_user,
    signer: lib_jwt_signer,
    redis: RedisClient,
  ): Promise<Static<typeof dto_auth.login.response>> {
    const access_token = await signer.sign({ user_id: user.user_id })
    const refresh_token = generate_refresh_token()
    await redis.set(refresh_key(refresh_token), String(user.user_id), 'EX', refresh_ttl_seconds)
    return {
      data: {
        access_token,
        refresh_token,
        expires_in: lib_jwt_access_ttl_seconds,
        user: to_auth_user(user),
      },
    }
  },

  async login(
    body: Static<typeof dto_auth.login.body>,
    signer: lib_jwt_signer,
    database: ReturnType<typeof create_database_client>,
    redis: RedisClient,
  ): Promise<Static<typeof dto_auth.login.response>> {
    const user = await database.main_db.user.findFirst({ where: { user_phone: body.user_phone, deleted_at: null } })
    await service_auth.verify(body.user_phone, body.otp_code, redis, Boolean(user))
    if (!user) throw lib_error.user_not_found
    return await service_auth.session(user, signer, redis)
  },

  async register(
    body: Static<typeof dto_auth.register.body>,
    signer: lib_jwt_signer,
    database: ReturnType<typeof create_database_client>,
    redis: RedisClient,
  ): Promise<Static<typeof dto_auth.register.response>> {
    await service_auth.verify(body.user_phone, body.otp_code, redis)
    const existing = await database.main_db.user.findFirst({ where: { user_phone: body.user_phone, deleted_at: null } })
    if (existing) throw lib_error.phone_already_exist
    const user = await database.main_db.user.create({
      data: {
        user_phone: body.user_phone,
        user_first_name: body.user_first_name,
        user_last_name: body.user_last_name,
        user_language: body.user_language ?? 'en',
      },
    })
    return await service_auth.session(user, signer, redis)
  },

  async refresh(
    body: Static<typeof dto_auth.refresh.body>,
    signer: lib_jwt_signer,
    database: ReturnType<typeof create_database_client>,
    redis: RedisClient,
  ): Promise<Static<typeof dto_auth.refresh.response>> {
    const user_id = Number(await redis.getdel(refresh_key(body.refresh_token)))
    if (!Number.isInteger(user_id) || user_id < 1) throw lib_error.invalid_token
    const user = await database.main_db.user.findFirst({ where: { user_id, deleted_at: null } })
    if (!user) throw lib_error.invalid_token
    return await service_auth.session(user, signer, redis)
  },

  async logout(
    body: Static<typeof dto_auth.logout.body>,
    redis: RedisClient,
  ): Promise<Static<typeof dto_auth.logout.response>> {
    await redis.del(refresh_key(body.refresh_token))
    return { data: { logged_out: true } }
  },
}
