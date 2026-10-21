import { Elysia } from 'elysia'

import { lib_jwt } from '@lib/jwt.lib'
import { dto_participant } from '@module/main/participants/participant.dto'
import { service_participant } from '@module/main/participants/participant.service'

export const controller_participant = new Elysia({ prefix: '/participant' })

  .use(lib_jwt)

  .patch(
    '/',
    async (context) => {
      const { payload, body, database, redis } = context

      return await service_participant.update(body, payload, database, redis)
    },
    dto_participant.update,
  )

  .delete(
    '/',
    async (context) => {
      const { payload, body, database, redis } = context

      return await service_participant.delete(body, payload, database, redis)
    },
    dto_participant.delete,
  )

  .post(
    '/mute',
    async (context) => {
      const { payload, body, database, redis } = context

      return await service_participant.mute(body, payload, database, redis)
    },
    dto_participant.mute,
  )

  .post(
    '/promote',
    async (context) => {
      const { payload, body, database, redis } = context

      return await service_participant.promote(body, payload, database, redis)
    },
    dto_participant.promote,
  )

  .post(
    '/demote',
    async (context) => {
      const { payload, body, database, redis } = context

      return await service_participant.demote(body, payload, database, redis)
    },
    dto_participant.demote,
  )
