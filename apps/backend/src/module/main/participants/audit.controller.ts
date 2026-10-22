import { Elysia } from 'elysia'

import { lib_jwt } from '@lib/jwt.lib'
import { dto_audit } from '@module/main/participants/audit.dto'
import { service_audit } from '@module/main/participants/audit.service'

export const controller_audit = new Elysia({ prefix: '/audit' })

  .use(lib_jwt)

  .get(
    '/',
    async (context) => {
      const { payload, query, database, redis } = context

      return await service_audit.find(query, payload, database, redis)
    },
    dto_audit.find,
  )
