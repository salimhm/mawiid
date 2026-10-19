---
name: example-errors
description: Required code pattern for all errors generated outputs.
---

- **error.lib.ts**: Strictly follow this pattern!

```typescript
// @ts-ignore
export const lib_error = {
  bad_request: { status: 400, code: 'bad-request' },
  invalid_token: { status: 401, code: 'invalid-token' },
  invalid_otp_code: { status: 401, code: 'invalid-otp-code' },
  code_expired: { status: 401, code: 'code-expired' },
  unauthorized: { status: 401, code: 'unauthorized' },
  not_found: { status: 404, code: 'not-found' },
  phone_already_exist: { status: 409, code: 'user-phone-exist' },
  unprocessable_entity: { status: 422, code: 'unprocessable-entity' },
  invalid_column: { status: 422, code: 'invalid-column' },
  internal_server_error: { status: 500, code: 'internal-server-error' },
  service_unavailable: { status: 503, code: 'service-unavailable' },
  // rest of errors
}
```
