import { describe, expect, test } from 'bun:test'
import { Elysia, t } from 'elysia'
import { lib_error } from '@lib/error.lib'
import { lib_middleware_error } from '@lib/middleware.lib'
import { dto_auth } from '@module/main/auth/auth.dto'

const app = new Elysia()
  .use(lib_middleware_error)
  .post('/register', () => ({ success: true }), { body: dto_auth.register.body })
  .get('/query', () => ({ success: true }), { query: t.Object({ page: t.Numeric({ minimum: 1 }) }) })
  .get('/item/:id', () => ({ success: true }), { params: t.Object({ id: t.String({ pattern: '^[0-9]+$', error: 'Enter a valid item ID.' }) }) })
  .post('/nested', () => ({ success: true }), { body: t.Object({ members: t.Array(t.Object({ name: t.String({ minLength: 1, error: 'Enter a name.' }) })) }) })
  .get('/login-failure', () => { throw lib_error.invalid_credentials })
  .compile()

function register(body: unknown) {
  return app.handle(new Request('http://localhost/register', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
}

const valid_body = {
  user_username: 'auth_test', user_email: 'user@example.com', user_password: 'Test-password-123!',
  user_first_name: 'Test', user_last_name: 'User',
}

describe('shared validation responses', () => {
  test('returns multiple readable field errors without submitted values', async () => {
    const response = await register({ ...valid_body, user_email: 'private-invalid-address', user_password: '123' })
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body).toEqual({
      code: 'validation-error', message: 'Please check the information you entered.',
      errors: [
        { field: 'user_email', message: 'Enter a valid email address.' },
        { field: 'user_password', message: 'Password must contain 8–128 characters.' },
      ],
    })
    expect(JSON.stringify(body)).not.toContain('private-invalid-address')
    expect(JSON.stringify(body)).not.toContain('123')
  })

  test('returns one error per missing field', async () => {
    const response = await register({})
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ errors: [
      { field: 'user_username', message: 'Username must contain 3–32 letters, numbers or underscores.' },
      { field: 'user_email', message: 'Enter a valid email address.' },
      { field: 'user_password', message: 'Password must contain 8–128 characters.' },
      { field: 'user_first_name', message: 'First name must contain 1–64 characters.' },
      { field: 'user_last_name', message: 'Last name must contain 1–64 characters.' },
    ] })
  })

  test('uses a readable fallback for schemas without custom messages', async () => {
    const response = await app.handle(new Request('http://localhost/query?page=invalid'))
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      code: 'validation-error', message: 'Please check the information you entered.',
      errors: [{ field: 'page', message: 'Please check this field.' }],
    })
  })

  test('uses a request-level error when numeric conversion supplies no field path', async () => {
    const response = await app.handle(new Request('http://localhost/query?page=0'))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ errors: [{ field: 'request', message: 'Please check this field.' }] })
  })

  test('identifies invalid route parameters', async () => {
    const response = await app.handle(new Request('http://localhost/item/abc'))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ errors: [{ field: 'id', message: 'Enter a valid item ID.' }] })
  })

  test('identifies nested array fields', async () => {
    const response = await app.handle(new Request('http://localhost/nested', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ members: [{ name: '' }] }),
    }))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ errors: [{ field: 'members.0.name', message: 'Enter a name.' }] })
  })

  test('keeps valid requests working', async () => {
    const response = await register(valid_body)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
  })

  test('keeps malformed JSON as a parse error', async () => {
    const response = await app.handle(new Request('http://localhost/register', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
    }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'bad-request' })
  })

  test('keeps authentication failures separate from field validation', async () => {
    const response = await app.handle(new Request('http://localhost/login-failure'))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'invalid-credentials' })
  })
})
