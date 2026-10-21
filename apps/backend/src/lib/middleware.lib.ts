import { Elysia } from 'elysia';
import { lib_error, type type_lib_error } from '@lib/error.lib';

const lib_error_codes = new Set<string>(Object.values(lib_error).map((error) => error.code));

function is_lib_error(error: unknown): error is type_lib_error {
  return typeof error === 'object' && error !== null && 'code' in error && lib_error_codes.has(String(error.code));
}

export const lib_middleware_error = new Elysia({ name: 'lib_middleware_error' }).onError(
  { as: 'global' },
  ({ error, code, set }) => {
    if (is_lib_error(error)) {
      set.status = error.status;
      return { code: error.code };
    }
    if (code === 'VALIDATION' || code === 'NOT_FOUND' || code === 'PARSE') return;
    console.error('Unhandled request error', code);
    set.status = lib_error.internal_server_error.status;
    return { code: lib_error.internal_server_error.code };
  },
);
