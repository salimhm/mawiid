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
    if (code === 'VALIDATION') {
      set.status = lib_error.validation_error.status
      const errors = new Map<string, { field: string; message: string }>()
      for (const issue of error.all) {
        const field = issue.path.replace(/^\//, '').replaceAll('/', '.') || (error.type === 'property' ? 'request' : error.type)
        const message = typeof issue.schema?.error === 'string' ? issue.schema.error : 'Please check this field.'
        errors.set(field, { field, message })
      }
      return {
        code: lib_error.validation_error.code,
        message: 'Please check the information you entered.',
        errors: [...errors.values()],
      }
    }
    if (is_lib_error(error)) {
      set.status = error.status
      return { code: error.code, ...('message' in error ? { message: error.message } : {}) }
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
