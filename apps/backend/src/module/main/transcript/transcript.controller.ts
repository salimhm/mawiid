import { Elysia } from 'elysia';

import { lib_middleware_context } from '@lib/middleware.lib';
import { dto_transcript } from '@module/main/transcript/transcript.dto';
import { service_transcript } from '@module/main/transcript/transcript.service';

export const controller_transcript = new Elysia({ prefix: '/transcript' })

  .use(lib_middleware_context)

  .post(
    '/internal',
    async (context) => {
      const { body, headers, database, redis } = context;

      return await service_transcript.internal(body, headers.authorization, database, redis);
    },
    dto_transcript.internal,
  );
