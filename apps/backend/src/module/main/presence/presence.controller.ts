import { Elysia } from 'elysia';

import { lib_context } from '@lib/context.lib';
import { lib_jwt } from '@lib/jwt.lib';
import { dto_presence } from '@module/main/presence/presence.dto';
import { service_presence } from '@module/main/presence/presence.service';

const controller_presence_socket = new Elysia()

  .use(lib_context)

  .resolve(async (context) => {
    const { query, database, redis } = context;

    return {
      socket_user: await service_presence.connect(
        String(query.ticket ?? ''),
        database,
        redis,
      ),
    };
  })

  .ws('/ws', {
    query: dto_presence.socket.query,
    body: dto_presence.socket.body,
    async open(ws) {
      for (const topic of ws.data.socket_user.topics) ws.subscribe(topic);
      await service_presence.open(ws.data.socket_user, ws.data.redis);
    },
    async message(ws, message) {
      await service_presence.message(
        ws.data.socket_user,
        message,
        ws.data.redis,
      );
    },
    async close(ws) {
      await service_presence.close(ws.data.socket_user, ws.data.redis);
    },
  });

export const controller_presence = new Elysia({ prefix: '/presence' })

  .use(controller_presence_socket)

  .use(lib_context)

  .use(lib_jwt)

  .post(
    '/ticket',
    async (context) => {
      const { payload, redis } = context;

      return await service_presence.ticket(payload, redis);
    },
    dto_presence.ticket,
  )

  .get(
    '/',
    async (context) => {
      const { payload, query, database, redis } = context;

      return await service_presence.find(query, payload, database, redis);
    },
    dto_presence.find,
  )

  .patch(
    '/',
    async (context) => {
      const { payload, body, database, redis } = context;

      return await service_presence.update(body, payload, database, redis);
    },
    dto_presence.update,
  );
