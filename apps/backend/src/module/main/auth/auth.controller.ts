import { Elysia, type Cookie } from 'elysia'

import { lib_jwt_sign } from '@lib/jwt.lib'
import { lib_middleware_context } from '@lib/middleware.lib'
import { dto_auth, dto_auth_refresh_cookie } from '@module/main/auth/auth.dto'
import { service_auth, service_auth_refresh_ttl_seconds } from '@module/main/auth/auth.service'

type auth_cookie = Record<string, Cookie<unknown>>

function write_refresh_cookie(cookie: auth_cookie, value: string, max_age: number) {
  cookie[dto_auth_refresh_cookie]!.set({
    value,
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: max_age,
  })
}

function deliver(cookie: auth_cookie, session: Awaited<ReturnType<typeof service_auth.session>>) {
  write_refresh_cookie(cookie, session.refresh_token, service_auth_refresh_ttl_seconds)
  return session.body
}

export const controller_auth = new Elysia({ prefix: '/auth' })

  .use(lib_middleware_context)

  .use(lib_jwt_sign)

  .post(
    '/register',
    async (context) => {
      const { body, cookie, lib_jwt_signer, database, redis } = context

      return deliver(cookie, await service_auth.register(body, lib_jwt_signer, database, redis))
    },
    dto_auth.register,
  )

  .post(
    '/login',
    async (context) => {
      const { body, cookie, lib_jwt_signer, database, redis } = context

      return deliver(cookie, await service_auth.login(body, lib_jwt_signer, database, redis))
    },
    dto_auth.login,
  )

  .post(
    '/otp',
    async (context) => {
      const { body, redis } = context

      return await service_auth.otp(body, redis)
    },
    dto_auth.otp,
  )

  .post(
    '/otp/login',
    async (context) => {
      const { body, cookie, lib_jwt_signer, database, redis } = context

      return deliver(cookie, await service_auth.otp_login(body, lib_jwt_signer, database, redis))
    },
    dto_auth.otp_login,
  )

  .post(
    '/otp/register',
    async (context) => {
      const { body, cookie, lib_jwt_signer, database, redis } = context

      return deliver(cookie, await service_auth.otp_register(body, lib_jwt_signer, database, redis))
    },
    dto_auth.otp_register,
  )

  .post(
    '/refresh',
    async (context) => {
      const { cookie, lib_jwt_signer, database, redis } = context
      const refresh_token = cookie[dto_auth_refresh_cookie].value

      try {
        return deliver(cookie, await service_auth.refresh(refresh_token, lib_jwt_signer, database, redis))
      } catch (error) {
        write_refresh_cookie(cookie, '', 0)
        throw error
      }
    },
    dto_auth.refresh,
  )

  .post(
    '/logout',
    async (context) => {
      const { cookie, redis } = context
      const refresh_token = cookie[dto_auth_refresh_cookie].value

      write_refresh_cookie(cookie, '', 0)
      return await service_auth.logout(refresh_token, redis)
    },
    dto_auth.logout,
  )
