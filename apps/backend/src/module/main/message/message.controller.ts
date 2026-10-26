import { Elysia } from 'elysia';

import { lib_jwt } from '@lib/jwt.lib';
import { dto_message } from '@module/main/message/message.dto';
import { service_message } from '@module/main/message/message.service';

export const controller_message = new Elysia({ prefix: '/message' })

  .use(lib_jwt)

  .get(
    '/',
    async (context) => {
      const { payload, query, database, redis } = context;

      return await service_message.find(query, payload, database, redis);
    },
    dto_message.find,
  )

  .post(
    '/',
    async (context) => {
      const { payload, body, database, redis } = context;

      return await service_message.create(body, payload, database, redis);
    },
    dto_message.create,
  );
