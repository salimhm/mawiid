# Auth implementation

## Implemented

- Username/email and password registration and login, with Argon2id password hashes.
- Development phone OTP request, login and registration. SMS delivery is not connected.
- Access JWTs, rotating refresh tokens in an HttpOnly cookie, and logout of the current refresh-token family.
- `user_email_verified_at` in the main user table and auth session responses. A timestamp means verified; `null` means no recorded verification.
- Internal email-verification and password-reset tokens in `auth-token.service.ts`.
- SMTP delivery and verification/reset templates in the email module. Password registration sends an email-verification link.
- `POST /auth/email/verify`: consumes a verification token and marks the matching active user's email as verified.
- `POST /auth/email/resend`: sends a replacement verification link for an unverified account, with a generic response and the signup cooldown.
- Password-enabled accounts require verified email before any new session can be issued or refreshed. Phone-only OTP accounts do not require email verification.
- `POST /auth/password/forgot`: emails a 30-minute password-reset link for an active, verified password account and returns a generic confirmation.
- `POST /auth/password/reset`: changes the password, increments the session version, clears the refresh cookie and attempts a password-changed notification.

## Step 1: verification foundation

Migration: `20261028140000_email_verification`.

The migration adds one nullable column without replacing the user table. Existing and new accounts have `user_email_verified_at = null` until the verification endpoint sets it. Existing users are not automatically considered verified. Registration returns an email-verification confirmation instead of a session. Password-enabled accounts now need verification for login and refresh; phone-only OTP accounts keep their existing flow.

`service_auth_token.create({ user_id, user_email }, purpose, redis)` returns `{ token, expires_in }` for an internal caller to put into an email link. The token contains 32 cryptographically random bytes. Redis keys contain its SHA-256 hash, never the raw token. The stored value binds it to a user ID and email address.

| Purpose | Expiry |
| --- | --- |
| `email_verification` | 24 hours |
| `password_reset` | 30 minutes |

`service_auth_token.delete(token, purpose, redis)` consumes the token and returns its user ID and email. Redis `GETDEL` makes consumption atomic. Unknown, expired, reused or wrong-purpose tokens raise `401 invalid-token`. A wrong-purpose attempt does not consume the correct token.

Each user and purpose now has a current-token pointer in Redis with the same expiry. Issuance swaps the pointer with `SET ... GET EX` and removes the previous tracked token. Consumption rejects a superseded token even if an older payload remains in Redis. The pointer contains only the hashed token key and expires normally; consuming an old token never deletes a newer pointer. Tokens emailed before this tracking was introduced remain usable until expiry or replacement. Replacements for one user or purpose do not invalidate another user or purpose.

These are internal service methods. Tokens do not grant an app session or change a user record by themselves. Verification and reset endpoints match a non-deleted user and the current email. Reset tokens also carry the user's session version; pre-upgrade tokens default to version 0. A consumed token stays consumed if a later database update fails; the user will need a new link.

## Step 3, first endpoint: verify email

`POST /auth/email/verify` is public: no Bearer token or session cookie is needed. It consumes an `email_verification` token, then updates only an active user whose ID and current email match the token and whose email is not already verified. The database filter enforces those conditions in the write itself. Verification does not sign the user in or issue a refresh cookie.

Example request, replacing the placeholder with an issued 43-character verification token:

```http
POST /auth/email/verify
Content-Type: application/json

{
  "token": "<issued-verification-token>"
}
```

Expected `200`:

```json
{
  "data": { "email_verified": true }
}
```

The matching user now has `user_email_verified_at` set. No user ID or email is accepted as the source of identity; only the token selects the account.

An unknown, expired, consumed, wrong-purpose or stale token returns `401`:

```json
{ "code": "invalid-token" }
```

Stale links include links for a missing/deleted user, a changed email or an already verified email. Existing verification timestamps are never overwritten. Wrong-purpose attempts do not consume a password-reset token. Of two concurrent requests with the same token, only one succeeds.

Example negative request that can be tested immediately without issuing a token:

```http
POST /auth/email/verify
Content-Type: application/json

{
  "token": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

Expected: `401` with `{ "code": "invalid-token" }`.

Missing tokens, non-string tokens and tokens that are not exactly 43 base64url characters return `422` with `code: "validation-error"`, the message `Please check the information you entered.`, and an `errors` entry for `token`: `This verification link is invalid.`.

Run `bun test src/module/main/auth/auth-verification.test.ts` from `apps/backend` to exercise successful verification with internally issued tokens. These endpoint tests use a temporary real SQLite database and an in-memory Redis substitute, without contacting remote services.

Signup now issues and emails verification tokens. Copy the `token` query parameter from the email link for a manual success test. Do not paste the literal placeholder expecting a successful response.

## Step 3, second endpoint: registration email

`POST /auth/register` remains public. It creates an unverified account with an Argon2id password hash, stores a 24-hour verification token in Redis, and sends the verification email. It returns a confirmation, not an access token or refresh cookie.

Configure `PUBLIC_APP_URL` in the root `.env`. Local development uses `http://localhost:3100`, the current frontend dev port. Other environments require HTTPS. The verification URL is built from this configured origin, never from request headers. Email links use `/auth/verify-email?token=...`.

Example request, replacing the email with an inbox you control and using a username not already registered:

```http
POST /auth/register
Content-Type: application/json

{
  "user_username": "auth_test_01",
  "user_email": "your-inbox@example.com",
  "user_password": "Test-password-123!",
  "user_first_name": "Test",
  "user_last_name": "User",
  "user_language": "en"
}
```

Expected `200`:

```json
{
  "data": {
    "verification_sent": true,
    "expires_in": 86400
  }
}
```

Check the inbox for `Verify your Mawiid email`. SMTP acceptance does not guarantee inbox delivery; check spam if necessary. No raw token, user record or password hash is returned by registration.

Frontend work is deferred, so the linked verification page is not implemented yet. For now, copy the token from the emailed URL and submit it to `POST /auth/email/verify` using the example above. Clicking the link alone does not verify the account yet. Do not add a GET verification route that consumes tokens just to support the temporary manual test.

| Status | Response | Meaning |
| --- | --- | --- |
| 409 | `{ "code": "user-username-exist" }` | Active username already exists |
| 409 | `{ "code": "user-email-exist" }` | Active email already exists |
| 422 | `validation-error` with `message` and `errors` | Invalid or missing request fields |
| 429 | `{ "code": "too-many-requests" }` | Another registration email was requested for this address within 60 seconds |
| 503 | `{ "code": "email-unavailable" }` | Invalid application URL or SMTP configuration, or delivery failure |

The per-address cooldown uses a hash of the normalized email. Existing active accounts still receive the existing conflict errors before a second email is attempted. Signup-wide IP limits remain part of auth hardening.

If token storage or email delivery fails after account creation, the newly created account is soft-deleted while still unverified and the issued token is invalidated when possible. The deleted account does not reserve its username/email; retry after the 60-second cooldown. If Redis cleanup is unavailable, the token expires normally and cannot verify the soft-deleted account. The cooldown is deliberately retained after a failure.

Run `bun test src/module/main/auth/auth-registration.test.ts` from `apps/backend`. Tests use a temporary real SQLite database, an in-memory Redis substitute, and mocked email delivery. They cover registration followed by verification, hashed passwords, no session creation, normalized fields, duplicate accounts, concurrency, cooldown, invalid origins, SMTP/token-storage failure and retry. No real email is sent by the tests.

## Step 3, third endpoint: resend verification

`POST /auth/email/resend` is public and requires no Bearer token or session cookie. It sends a replacement 24-hour link only for an active, unverified account. It does not create an account or session.

Wait at least 60 seconds after registration or the previous resend, then use an unverified account's address:

```http
POST /auth/email/resend
Content-Type: application/json

{
  "user_email": "your-inbox@example.com"
}
```

Expected `200`:

```json
{
  "data": {
    "message": "If your account needs verification, an email will arrive shortly."
  }
}
```

Unknown, already verified and deleted accounts receive the same response body and do not receive email. This makes the success response independent of account state; it does not guarantee identical response timing. Those requests also take the same per-address cooldown. The cooldown is shared with registration and uses the normalized email hash.

For an eligible account, the latest email contains a new verification token; previous links become invalid. Copy the latest token into `POST /auth/email/verify` as documented above. The frontend verification page is still deferred. Repeating a request within 60 seconds returns `429` with `{ "code": "too-many-requests" }`.

Malformed/missing email input returns `422`:

```json
{
  "code": "validation-error",
  "message": "Please check the information you entered.",
  "errors": [
    { "field": "user_email", "message": "Enter a valid email address." }
  ]
}
```

SMTP failure returns `503` with `{ "code": "email-unavailable" }`. The newly issued token is invalidated when possible, and the existing account is preserved. Since replacement already invalidated previous links, retry after the retained 60-second cooldown to obtain another link. A failure before replacement token storage leaves the original link usable. Invalid application URL/configuration follows the same behavior as registration.

The auth tests cover link replacement, old-link rejection, legacy-token compatibility, verified/deleted/unknown accounts, address normalization, cooldown sharing, concurrent requests, expiration, account preservation, failure cleanup and retry. Token replacement was also smoke-checked against the configured Redis with disposable keys that were removed afterward; no email or main-database mutation was involved in that smoke check.

No new environment variables or migrations are needed. Password-enabled accounts must verify their email before signing in or refreshing a session, as described below.

## Step 3 completion: verification enforcement

The shared session method checks the account's private password hash and verification timestamp before signing a JWT or storing a refresh token. Every password-enabled account must have a verified email, including older accounts. No existing account is automatically marked verified or exempted. Correct password credentials are checked before returning the verification error; incorrect credentials remain the generic `401 invalid-credentials`.

### Password login

No Bearer token or cookie is required:

```http
POST /auth/login
Content-Type: application/json

{
  "user_identifier": "auth_test_01",
  "user_password": "Test-password-123!"
}
```

Use the credentials of an account created through registration. If the credentials are correct but the email is unverified, expect `403`:

```json
{
  "code": "email-not-verified",
  "message": "Please verify your email before signing in."
}
```

No access token or refresh cookie is issued, and login does not automatically send another email. Request a link using `POST /auth/email/resend`, verify its token through `POST /auth/email/verify`, then repeat the same login request.

After verification, expect `200` with `data.access_token`, `data.expires_in: 900`, `data.user` including the verification timestamp, and the HttpOnly refresh cookie. `user_identifier` accepts either username or email. Incorrect passwords, unknown users and phone-only users without a password still receive `401` with `{ "code": "invalid-credentials" }`.

### Session refresh

No JSON body or Bearer token is required. Browsers send the refresh cookie automatically after successful login; the explicit header below is for API clients:

```http
POST /auth/refresh
Cookie: __Host-mawiid_refresh=<current-refresh-token>
```

For a verified password account with a valid refresh cookie, expect `200` with a new session and a rotated refresh cookie. A previously issued refresh cookie for an unverified password account returns the same `403 email-not-verified` response above. Its refresh-token family is revoked, the token is consumed, and the response clears the browser's refresh cookie. After verifying the email, the user must log in again; the revoked cookie cannot be revived by verification.

Missing, expired or invalid refresh cookies return `401` with `{ "code": "invalid-token" }` and clear the cookie. Current verification status is read from the database on every refresh.

### Phone-only and combined accounts

An account with no password hash can still use OTP login and refresh without an email. For example, using a real issued code:

```http
POST /auth/otp/login
Content-Type: application/json

{
  "user_phone": "+15550000123",
  "otp_code": "123456"
}
```

With a valid OTP, a phone-only account receives `200` with a session. An account that also has a password receives `403 email-not-verified` until its email is verified, even when the OTP is correct. This keeps the shared session policy consistent. Once verified, either supported sign-in method works.

### Existing accounts and testing

Existing password accounts with a reachable email can use resend and verification. A legacy password account with no email remains blocked and needs its email corrected through an authorized account-management process before verification; this change does not invent an email or silently mark it verified.

Access JWTs normally expire after 15 minutes. Password reset now also invalidates earlier JWTs immediately on their next protected request by comparing session versions. Email-verification enforcement and normal logout alone do not increment that version. Rejected refresh families are revoked when refresh is attempted.

The auth registration test file covers blocked login, username/email login after verification, generic wrong-password responses, legacy refresh rejection, cookie clearing, refresh-family revocation, status changes between login and refresh, phone-only access and combined-account OTP enforcement. Tests use local SQLite, mocked Redis and mocked email delivery, without modifying remote users or sending email. No migration or environment-variable change is needed.

## Step 4, first endpoint: forgot password

`POST /auth/password/forgot` is public. No Bearer token or session cookie is required. Only an active account with both a verified email and a password hash receives a reset email. Unknown, deleted, unverified and phone-only accounts receive the same confirmation body without a reset email. An unverified account should use the existing verification/resend flow first.

Example request, using the verified email from a password account:

```http
POST /auth/password/forgot
Content-Type: application/json

{
  "user_email": "your-inbox@example.com"
}
```

Expected `200`:

```json
{
  "data": {
    "message": "If your account is eligible, a password reset link will arrive shortly."
  }
}
```

For an eligible account, check the inbox for `Reset your Mawiid password`. The link uses `PUBLIC_APP_URL/auth/reset-password?token=...`. No token or account information is returned in the response. The frontend page remains deferred; copy the token into `POST /auth/password/reset` below to change the password through the backend.

Tokens are purpose-bound, expire after 30 minutes and can be consumed once. Requesting another link after the cooldown invalidates previous reset links. Reset tokens cannot be used by the email-verification endpoint, and requesting a reset does not replace email-verification tokens.

The reset-request cooldown is one request per normalized email address per 60 seconds, including ineligible addresses. It is separate from the signup/verification-email cooldown. Requests within that window return `429` with `{ "code": "too-many-requests" }`.

Malformed or missing email input returns `422`:

```json
{
  "code": "validation-error",
  "message": "Please check the information you entered.",
  "errors": [
    { "field": "user_email", "message": "Enter a valid email address." }
  ]
}
```

Missing/invalid application URL or SMTP configuration and SMTP delivery failure return `503` with `{ "code": "email-unavailable" }`. A token-storage outage follows existing service/server error handling. Failed email delivery invalidates the new reset token when possible. The cooldown is retained, so wait 60 seconds before retrying. If a previous reset link was replaced before delivery failed, request another link; the older one is not restored.

Requesting a reset never changes the user record, password, verification status or active sessions. The reset endpoint changes credentials after token verification. Responses wait for SMTP delivery attempts: the confirmation body is generic, but processing time and delivery-failure responses can differ by account state. Broader IP limits and asynchronous email delivery remain hardening work.

Tests in `auth-registration.test.ts` cover eligible and ineligible accounts, normalization, links/expiry/purpose, replacement, concurrency, cooldown, validation errors, email/token-storage failures, and preservation of passwords and existing sessions. They use local SQLite and mocked email/Redis; no real email is sent. No migration, dependency or environment-variable change is needed.

## Step 4 completion: reset password

Migration `20261029120000_password_reset_sessions` adds `user_session_version` with default 0 to main users, preserving existing accounts. It was applied to the main database in the root `.env` on 2026-10-29. Other main databases need the same migration before using the regenerated client. No tenant migration or new environment variable is needed.

Request a fresh link using `POST /auth/password/forgot`, then copy its 43-character token. No login, cookie or Bearer token is required:

```http
POST /auth/password/reset
Content-Type: application/json

{
  "token": "<issued-reset-token>",
  "user_password": "New-password-456!"
}
```

Expected `200`:

```json
{
  "data": {
    "password_reset": true,
    "notification_sent": true
  }
}
```

The reset consumes a `password_reset` token and checks an active, verified password account with the matching current email and session version. One conditional write replaces the Argon2id hash and increments the version. The old hash is also checked, so a concurrent password change cannot be overwritten. Failed email/username login counters are cleared when Redis is available. A phone-only account cannot acquire a password through this endpoint.

The endpoint does not sign in and clears the browser refresh cookie. Sign in through `POST /auth/login` using the new password. Confirmation email subject: `Your Mawiid password was changed`; it contains no password or reset token. If delivery fails after the database update, the response remains `200` with `notification_sent: false`. The password is already changed; do not retry that token. Post-update email/counter-cleanup failures are logged generically without submitted values.

Unknown, expired, used, superseded, wrong-purpose or stale tokens return `401` with `{ "code": "invalid-token" }`. Changed emails, deleted/unverified accounts, missing passwords and a changed session version are also rejected. Invalid password length (8–128) or malformed token returns the shared `422 validation-error` with field messages before token consumption. A database failure after consumption requires requesting a new link. The future frontend should compare a password confirmation before submitting the single new password.

### Session version checks

New JWTs carry `session_version`; refresh records store `user_id:family:session_version`. `lib_jwt` checks the current user/version through `auth-session.service.ts`, adding one main-database read per protected request. Missing/deleted users and stale versions fail with `401 invalid-token`. The payload passed to modules remains `{ user_id }`; no password hash or database version is added to the public user DTO.

Existing JWTs, two-part refresh records and old reset links default to version 0. They remain compatible after the additive migration until that user's first reset. After a reset, all older access/refresh sessions and reset links fail their version check. Fresh sign-ins use the new version. Other users are unaffected. Old Redis records may remain until expiry but cannot authenticate; no broad Redis scan is needed.

Normal logout still revokes its refresh family. This change does not disconnect established WebSockets, stop ongoing LiveKit calls or revoke separately issued socket tickets/media tokens. Participants and presence implementations are unchanged.

Tests cover new/old passwords, multiple-session invalidation, cross-user isolation, legacy compatibility, expired/stale/reused tokens, concurrent submissions, conditional-write races, validation-before-consumption, notification failure and login-counter cleanup. Email tests render messages in memory. Tests use an isolated signing secret, local SQLite and mocked Redis/email; no real reset email is sent by the tests.

## Current endpoint contracts

Schema validation failures use the shared format documented in `docs/backend-validation.md`: HTTP `422`, `code: "validation-error"`, a readable `message`, and an `errors` array of `{ field, message }`. Auth fields have specific messages; submitted values are not returned. Other authentication/business errors retain their existing response format.

| Method | Path | Request | Result |
| --- | --- | --- | --- |
| POST | `/auth/register` | Username, email, password, first/last name, optional language | `{ data: { verification_sent: true, expires_in: 86400 } }` |
| POST | `/auth/email/verify` | `token` | `{ data: { email_verified: true } }` |
| POST | `/auth/email/resend` | `user_email` | Generic confirmation message |
| POST | `/auth/password/forgot` | `user_email` | Generic confirmation message; sends a reset link only for an eligible account |
| POST | `/auth/password/reset` | `token`, `user_password` | `password_reset: true` and `notification_sent` |
| POST | `/auth/login` | `user_identifier`, `user_password` | Session after email verification; otherwise `403 email-not-verified` for correct credentials |
| POST | `/auth/otp` | `user_phone` | Expiry and development-only code; unavailable outside `ENV=dev` |
| POST | `/auth/otp/login` | `user_phone`, `otp_code` | Session, or `user-not-found` after code validation |
| POST | `/auth/otp/register` | Phone, code, first/last name, optional language | Session |
| POST | `/auth/refresh` | Refresh cookie | Rotated session; unverified password accounts lose their refresh family and receive `403` |
| POST | `/auth/logout` | Refresh cookie | `{ data: { logged_out: true } }` |

Session responses use `{ data: { access_token, expires_in, user } }`. The user includes `user_email_verified_at`, serialized as a date string or `null`. Refresh tokens are only delivered in the `__Host-mawiid_refresh` cookie. Public signup/login/OTP routes require no existing session; refresh requires a valid refresh cookie. Protected application routes require a Bearer access token.

## Deployment and testing

The backend runs on port 3000. Its `/` path has no route and returns `404` with `{ "code": "not-found" }`; the frontend runs separately on port 3100.

OpenAPI is registered directly in `src/app.ts` for both `dev` and `postman:dev`. It does not require `OPENAPI_ENABLED`.

```http
GET /openapi
```

Expected `200` with the interactive HTML API documentation. No body or authentication required.

```http
GET /openapi/json
```

Expected `200` with the OpenAPI JSON specification, including `POST /auth/register` and `POST /auth/email/verify`. No body or authentication required.

Both startup scripts run the same app. `dev` loads the root `.env`; `postman:dev` loads `postman/.env.postman`. For registration email tests, use `bun run dev` so the SMTP settings and `PUBLIC_APP_URL` configured in the root `.env` are loaded.

From `apps/backend`:

```bash
bun run db:generate
bun run db:deploy:main
bun test src/module/main/auth/auth-token.test.ts
bun run typecheck
```

`db:deploy:main` applies pending main migrations to the `TURSODB_URL` configured in the root `.env`. Apply the migration before running the backend with the regenerated client. Tenant databases do not need this migration. This change does not deploy to a remote database automatically.

### Remote migration history reconciliation, 2026-10-28

The root `.env` main database had already applied `20261021220000_room_creation`, which created `vault` and `room_route`. The current branch instead includes `20261021103254_add_vault_room_route`, which also adds `user_language`. Deployment therefore tried to recreate existing tables.

After checking the existing table definitions and indexes, the missing nullable `user_language` column was added and the replacement migration was recorded as applied. The older history entry was preserved. The normal runner then applied `20261026120000_add_user_password` and `20261028140000_email_verification`.

All existing records were compared before and after: 3 users, 1 vault and 2 room routes were preserved; foreign-key checks passed. This was a one-time repair of that database, not a general rule to skip migrations whenever a table exists. Databases with a different history need their own schema check before reconciliation.

The tests use an in-memory Redis substitute for expiry and consumption checks, and a real in-memory SQLite database for migration preservation. They cover random/hashed tokens, purpose separation, expiry, repeated consumption, concurrent consumers, and existing/new user defaults. They do not contact Redis, Turso, email or SMS services.

After deployment, password accounts must verify their email before password login or refresh. Phone-only accounts retain their existing flow. Session responses include the recorded verification timestamp, or `null` for phone-only accounts without a verified email. No additional migration is needed for verification enforcement.

## Still missing, in backend implementation order

1. OTP hardening and real SMS delivery, including binding pending codes to session versions.
2. Verified email/phone linking and safe contact/password changes. Future credential changes must also increment the session version.
3. Session completion, including logout everywhere and cleanup of long-lived connections when required.

Future recovery endpoints need request limits, expiring single-use links, invalidation of superseded links, and delivery-failure handling. Recovery responses must not reveal whether an email exists. Signup-wide IP limits remain part of auth hardening. Token issuance now permits one current token per user and purpose.

Frontend work is deferred until the backend is complete. The existing frontend signup UI still expects the old session response and must be adapted when frontend work begins. Test the new registration flow directly through the backend for now. No new database migration is needed for this registration change.
