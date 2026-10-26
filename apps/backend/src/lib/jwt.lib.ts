import { Elysia } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import type { lib_dto_payload } from '@lib/dto.lib';
import { lib_error } from '@lib/error.lib';
import { lib_middleware_context } from '@lib/middleware.lib';

export const lib_jwt = new Elysia({ name: 'lib_jwt' })
  .use(lib_middleware_context)
  .use(
    jwt({
      name: 'lib_jwt_signer',
      secret: process.env.JWT_SECRET_KEY!,
      exp: '15m',
    }),
  )
  .derive({ as: 'scoped' }, async ({ headers, lib_jwt_signer }) => {
    const [scheme, token] = headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) throw lib_error.unauthorized;
    const claims = await lib_jwt_signer.verify(token);
    const user_id = claims ? Number(claims.user_id) : NaN;
    if (!Number.isInteger(user_id) || user_id < 1)
      throw lib_error.invalid_token;
    const payload: lib_dto_payload = { user_id };
    return { payload };
  });
