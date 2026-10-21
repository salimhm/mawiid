import { Elysia } from 'elysia';
import type { lib_dto_payload } from '@lib/dto.lib';
import { lib_error } from '@lib/error.lib';

export const lib_jwt = new Elysia({ name: 'lib_jwt' }).derive({ as: 'scoped' }, ({ headers }) => {
  const user_id = Number(headers['x-user-id']);
  if (process.env.ENV !== 'dev' || !Number.isInteger(user_id) || user_id <= 0) throw lib_error.unauthorized;
  const payload: lib_dto_payload = { user_id };
  return { payload };
});
