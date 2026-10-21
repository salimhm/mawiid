import { Elysia } from 'elysia'

import { lib_middleware_context } from '@lib/middleware.lib'
import { dto_participant } from '@module/main/participants/participant.dto'
import { service_participant } from '@module/main/participants/participant.service'

export const controller_webhook = new Elysia({ prefix: '/webhook' })

  .use(lib_middleware_context)

  .post(
    '/livekit',
    async (context) => {
      const { body, headers, database, redis } = context

      return await service_participant.webhook(body, headers.authorization, database, redis)
    },
    { ...dto_participant.webhook, parse: 'text' },
  )
