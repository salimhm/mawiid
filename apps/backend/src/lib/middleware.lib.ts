import { Elysia } from 'elysia'
import type { RedisClient } from 'bun'
import type { create_database_client } from '@db/client.db'
import { lib_error, type lib_error_value } from '@lib/error.lib'

const lib_error_values: unknown[] = Object.values(lib_error)

function is_lib_error(error: unknown): error is lib_error_value {
  return lib_error_values.includes(error)
}

export const lib_middleware_context = new Elysia({ name: 'lib_middleware_context' })
  .decorate('database', null as unknown as ReturnType<typeof create_database_client>)
  .decorate('redis', null as unknown as RedisClient)

export const lib_middleware_error = new Elysia({ name: 'lib_middleware_error' }).onError(
  { as: 'global' },
  ({ code, error, set }) => {
    if (is_lib_error(error)) {
      set.status = error.status
      return { code: error.code }
    }
    if (code === 'VALIDATION') {
      set.status = lib_error.unprocessable_entity.status
      return { code: lib_error.unprocessable_entity.code }
    }
    if (code === 'PARSE') {
      set.status = lib_error.bad_request.status
      return { code: lib_error.bad_request.code }
    }
    if (code === 'NOT_FOUND') {
      set.status = lib_error.not_found.status
      return { code: lib_error.not_found.code }
    }
    console.error(error)
    set.status = lib_error.internal_server_error.status
    return { code: lib_error.internal_server_error.code }
  },
)
