# Auth

Two ways to sign in, both ending in the same session:

- **Password**: a username or an email, plus a password.
- **Phone code (OTP)**: a phone number (E.164, e.g. `+21355000000`) and a 6-digit code.

## Endpoints

| Method | Path                 | Body                                                                                                   | Returns                   |
| ------ | -------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------- |
| POST   | `/auth/register`     | `user_username`, `user_email`, `user_password`, `user_first_name`, `user_last_name`, `user_language?` | session                   |
| POST   | `/auth/login`        | `user_identifier` (username or email), `user_password`                                                 | session                   |
| POST   | `/auth/otp`          | `user_phone`                                                                                           | `expires_in`, `otp_code`* |
| POST   | `/auth/otp/login`    | `user_phone`, `otp_code`                                                                               | session                   |
| POST   | `/auth/otp/register` | `user_phone`, `otp_code`, `user_first_name`, `user_last_name`, `user_language?`                        | session                   |
| POST   | `/auth/refresh`      | none, reads the refresh cookie                                                                         | session                   |
| POST   | `/auth/logout`       | none, reads the refresh cookie                                                                         | `logged_out`              |

A session response is `{ access_token, expires_in, user }`. Send the access token as `Authorization: Bearer <access_token>`;
routes that `.use(lib_jwt)` reject a missing, invalid or expired one with `401`.

The refresh token is never in a response body. It is set as the cookie `__Host-mawiid_refresh` (`HttpOnly; Secure;
SameSite=Strict; Path=/`, 30 days), so page scripts cannot read it and other sites cannot send it. Browsers accept `Secure`
cookies on `http://localhost`, so local development works without HTTPS.

*No SMS provider is wired yet: `/auth/otp` only works with `ENV=dev`, where the code is returned in the response and logged
to the console. Other environments get `503 service-unavailable`.

## Passwords

- Hashed with argon2id (`Bun.password`, 19 MiB memory, 2 iterations: the OWASP baseline). Only the hash is stored
  (`user_password_hash`) and it is never returned.
- 8 to 128 characters. Usernames are 3 to 32 letters, digits or underscores. Usernames and emails are trimmed, lowercased
  and unique among non-deleted users.
- An identifier containing `@` is looked up as an email, otherwise as a username.
- Unknown users, users without a password (phone-only accounts) and wrong passwords all get the same
  `401 invalid-credentials`, and an unknown user still costs one hash check, so responses do not reveal which accounts exist.
- Ten failed logins for one identifier within 15 minutes block it with `429 too-many-requests` until the window ends.

## Tokens

- Access tokens are HS256 JWTs signed with `JWT_SECRET_KEY`, carry `user_id`, and last 15 minutes.
- Refresh tokens are 256-bit random values, stored in Redis only as a SHA-256 hash (`auth_refresh:<hash>`). Each login
  starts a token family (`auth_refresh_family:<id>`).
- Every refresh consumes the token and issues a new one in the same family. A rotated token presented again more than
  30 seconds later is treated as stolen: the whole family is revoked and every holder must sign in again. Within 30 seconds
  it is only rejected, which covers two tabs refreshing at once.
- Logout deletes the token and its family and clears the cookie. Access tokens already issued stay valid until they expire.

## OTP rules

- Codes are 6 digits, valid 5 minutes, single use, stored hashed in Redis (`auth_otp:<phone>`).
- One code request per phone every 60 seconds (`429 too-many-requests`).
- Five wrong codes invalidate the current code.

## Errors

| Status | Code                   | Meaning                                                                               |
| ------ | ---------------------- | ------------------------------------------------------------------------------------- |
| 401    | `invalid-credentials`  | Wrong identifier or password                                                          |
| 401    | `invalid-otp-code`     | Wrong code                                                                            |
| 401    | `code-expired`         | No pending code (expired, used, or too many attempts)                                 |
| 401    | `invalid-token`        | Missing, unknown, used or revoked refresh token, or an invalid or expired access token |
| 404    | `user-not-found`       | OTP login for a phone with no account: the code is kept, send it to `/auth/otp/register` |
| 409    | `user-username-exist`  | Register with a username already in use                                              |
| 409    | `user-email-exist`     | Register with an email already in use                                                 |
| 409    | `user-phone-exist`     | OTP register for a phone that already has an account                                  |
| 422    | `unprocessable-entity` | A field failed validation (format, length, missing)                                   |
| 429    | `too-many-requests`    | Too many failed logins, or a code requested less than 60 seconds ago                  |
| 503    | `service-unavailable`  | Code delivery is not available outside dev                                            |
