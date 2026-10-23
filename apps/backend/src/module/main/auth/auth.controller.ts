import { Elysia } from 'elysia'

import { lib_jwt_sign } from '@lib/jwt.lib'
import { lib_middleware_context } from '@lib/middleware.lib'
import { dto_auth } from '@module/main/auth/auth.dto'
import { service_auth } from '@module/main/auth/auth.service'

export const controller_auth = new Elysia({ prefix: '/auth' })

  .use(lib_middleware_context)

  .use(lib_jwt_sign)

  .post(
    '/otp',
    async (context) => {
      const { body, redis } = context

      return await service_auth.otp(body, redis)
    },
    dto_auth.otp,
  )

  .post(
    '/login',
    async (context) => {
      const { body, lib_jwt_signer, database, redis } = context

      return await service_auth.login(body, lib_jwt_signer, database, redis)
    },
    dto_auth.login,
  )

  .post(
    '/register',
    async (context) => {
      const { body, lib_jwt_signer, database, redis } = context

      return await service_auth.register(body, lib_jwt_signer, database, redis)
    },
    dto_auth.register,
  )

  .post(
    '/refresh',
    async (context) => {
      const { body, lib_jwt_signer, database, redis } = context

      return await service_auth.refresh(body, lib_jwt_signer, database, redis)
    },
    dto_auth.refresh,
  )

  .post(
    '/logout',
    async (context) => {
      const { body, redis } = context

      return await service_auth.logout(body, redis)
    },
    dto_auth.logout,
  )
