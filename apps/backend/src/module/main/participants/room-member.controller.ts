import { Elysia } from 'elysia'

import { lib_jwt } from '@lib/jwt.lib'
import { dto_room_member } from '@module/main/participants/room-member.dto'
import { service_room_member } from '@module/main/participants/room-member.service'

export const controller_room_member = new Elysia({ prefix: '/room-member' })

  .use(lib_jwt)

  .patch(
    '/',
    async (context) => {
      const { payload, body, database, redis } = context

      return await service_room_member.update(body, payload, database, redis)
    },
    dto_room_member.update,
  )

  .delete(
    '/',
    async (context) => {
      const { payload, body, database, redis } = context

      return await service_room_member.delete(body, payload, database, redis)
    },
    dto_room_member.delete,
  )
