# Backend validation responses

All endpoints using `lib_middleware_error` return HTTP `422` for schema validation failures:

```json
{
  "code": "validation-error",
  "message": "Please check the information you entered.",
  "errors": [
    {
      "field": "user_password",
      "message": "Password must contain 8–128 characters."
    }
  ]
}
```

`code` is for application logic. The frontend can display `message` as a form-level notification and each `errors` entry beneath its matching input. Frontend rendering is not implemented by this change.

## Messages and fields

- Auth DTOs provide custom messages for username, email, password, names, language, phone, OTP and verification tokens.
- Other schemas use their custom `error` string when present; otherwise the message is `Please check this field.`.
- There is one entry per field, including when Elysia reports several issues for that field.
- Nested fields use dotted paths, for example `members.0.name`.
- Root errors use the validation location, such as `body`. Some numeric conversion failures do not identify the original field; those use `request` and should be displayed at form level.
- Submitted values, raw validator errors, schemas and stack traces are not included in this response.

Custom DTO messages should be fixed, readable strings. Avoid interpolating submitted values into them.

## Example request

No authentication is required:

```http
POST /auth/register
Content-Type: application/json

{
  "user_username": "auth_test_01",
  "user_email": "user@example.com",
  "user_password": "123",
  "user_first_name": "Test",
  "user_last_name": "User"
}
```

Expected: HTTP `422` and the response shown above. The request is rejected before registration or email delivery. If several fields are invalid, `errors` contains their individual messages.

Malformed JSON remains HTTP `400` with `{ "code": "bad-request" }`. Authentication and business errors retain their existing status and code; for example, invalid credentials remain HTTP `401` with `{ "code": "invalid-credentials" }`.

This replaces the former schema-validation code `unprocessable-entity`. Clients and smoke checks must use `validation-error` for those responses. No frontend files, participants service files or presence service files are modified.

## Testing

From `apps/backend`:

```bash
bun test src/lib/middleware.test.ts
bun test src
bun run typecheck
```

The middleware tests cover multiple fields, missing fields, nested paths, query/route parameters, conversion fallback, absence of submitted values, valid requests, parse errors and unchanged authentication failures. These tests do not contact databases or send emails. Auth endpoint tests additionally exercise this format through real controller requests and temporary SQLite databases.
