import { Elysia } from 'elysia'

import { lib_jwt } from '@lib/jwt.lib'
import { dto_room } from '@module/main/participants/room.dto'
import { service_room } from '@module/main/participants/room.service'

export const controller_room = new Elysia({ prefix: '/room' })

  .use(lib_jwt)

  .patch(
    '/',
    async (context) => {
      const { payload, body, database, redis } = context

      return await service_room.update(body, payload, database, redis)
    },
    dto_room.update,
  )

  .post(
    '/join',
    async (context) => {
      const { payload, body, database, redis } = context

      return await service_room.join(body, payload, database, redis)
    },
    dto_room.join,
  )
