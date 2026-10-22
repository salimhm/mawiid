import { Elysia } from 'elysia'

import { lib_jwt } from '@lib/jwt.lib'
import { lib_middleware_context } from '@lib/middleware.lib'
import { dto_event } from '@module/main/participants/event.dto'
import { event_user_topic, service_event } from '@module/main/participants/event.service'

export const controller_event = new Elysia({ prefix: '/event' })

  .use(lib_middleware_context)

  .ws('/ws', {
    ...dto_event.socket,
    async open(ws) {
      const user_id = await service_event.open(ws.data.query.ticket, ws.data.redis)
      if (!user_id) return ws.close(4401, 'invalid-ticket')
      ws.subscribe(event_user_topic(user_id))
    },
    message(ws, message) {
      if (message === 'ping') ws.send('pong')
    },
  })

  .use(lib_jwt)

  .post(
    '/ticket',
    async (context) => {
      const { payload, redis } = context

      return await service_event.ticket(payload, redis)
    },
    dto_event.ticket,
  )
