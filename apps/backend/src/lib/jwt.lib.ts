import { Elysia } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import type { lib_dto_payload } from '@lib/dto.lib';
import { lib_error } from '@lib/error.lib';
import { lib_middleware_context } from '@lib/middleware.lib';
import { service_auth_session } from '@module/main/auth/auth-session.service';

export const lib_jwt_access_ttl_seconds = 15 * 60

export const lib_jwt_sign = new Elysia({ name: 'lib_jwt_sign' })
  .use(jwt({ name: 'lib_jwt_signer', secret: process.env.JWT_SECRET_KEY!, exp: `${lib_jwt_access_ttl_seconds}s` }))

export type lib_jwt_signer = (typeof lib_jwt_sign)['decorator']['lib_jwt_signer']

export const lib_jwt = new Elysia({ name: 'lib_jwt' })
  .use(lib_middleware_context)
  .use(lib_jwt_sign)
  .derive({ as: 'scoped' }, async ({ headers, lib_jwt_signer, database }) => {
    const [scheme, token] = headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) throw lib_error.unauthorized;
    const claims = await lib_jwt_signer.verify(token);
    const user_id = claims ? Number(claims.user_id) : NaN;
    if (!Number.isInteger(user_id) || user_id < 1)
      throw lib_error.invalid_token;
    const session_version = Number(claims ? claims.session_version ?? 0 : 0);
    if (!Number.isSafeInteger(session_version) || session_version < 0) throw lib_error.invalid_token;
    const payload: lib_dto_payload = await service_auth_session.find({ user_id }, session_version, database);
    return { payload };
  });
