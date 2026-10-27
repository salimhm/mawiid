import { Elysia } from 'elysia'
import { lib_jwt } from '@lib/jwt.lib'
import { lib_middleware_context } from '@lib/middleware.lib'
import { dto_room } from '@module/tenant/room/room.dto'
import { service_room } from '@module/tenant/room/room.service'

export const controller_room = new Elysia({ prefix: '/room' })
  .use(lib_middleware_context)
  .use(lib_jwt)
  .post(
    '/join',
    async (context) => {
      const { payload, body, database } = context

      return await service_room.join(body, payload, database)
    },
    dto_room.join,
  )
  .get(
    '/',
    async (context) => {
      const { payload, query, database } = context

      return await service_room.find(query, payload, database)
    },
    dto_room.find,
  )
  .post(
    '/',
    async (context) => {
      const { payload, body, database } = context

      return await service_room.create(body, payload, database)
    },
    dto_room.create,
  )
  .patch(
    '/',
    async (context) => {
      const { payload, body, database } = context

      return await service_room.update(body, payload, database)
    },
    dto_room.update,
  )
  .delete(
    '/',
    async (context) => {
      const { payload, body, database } = context

      return await service_room.delete(body, payload, database)
    },
    dto_room.delete,
  )
