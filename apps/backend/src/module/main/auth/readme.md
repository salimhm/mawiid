# Auth

Phone number and one-time code (OTP) authentication. Users are identified by `user_phone` (E.164, e.g. `+21355000000`).

## Endpoints

| Method | Path             | Body                                                                          | Returns                    |
| ------ | ---------------- | ----------------------------------------------------------------------------- | -------------------------- |
| POST   | `/auth/otp`      | `user_phone`                                                                  | `expires_in`, `otp_code`*  |
| POST   | `/auth/login`    | `user_phone`, `otp_code`                                                      | session                    |
| POST   | `/auth/register` | `user_phone`, `otp_code`, `user_first_name`, `user_last_name`, `user_language?` | session                  |
| POST   | `/auth/refresh`  | `refresh_token`                                                               | session                    |
| POST   | `/auth/logout`   | `refresh_token`                                                               | `logged_out`               |

A session is `{ access_token, refresh_token, expires_in, user }`. Send the access token as `Authorization: Bearer <access_token>`.

*No SMS provider is wired yet: `/auth/otp` only works with `ENV=dev`, where the code is returned in the response and logged to the console. Other environments get `503 service-unavailable`.

## Rules

- Codes are 6 digits, valid 5 minutes, single use, stored hashed in Redis (`auth_otp:<phone>`).
- One code request per phone every 60 seconds (`429 too-many-requests`).
- Five wrong codes invalidate the current code.
- Access tokens last 15 minutes. Refresh tokens last 30 days, are stored in Redis (`auth_refresh:<token>`) and rotate on every refresh: an old refresh token is rejected.

## Errors

| Status | Code                | Meaning                                       |
| ------ | ------------------- | --------------------------------------------- |
| 401    | `invalid-otp-code`  | Wrong code                                    |
| 401    | `code-expired`      | No pending code (expired, used, or too many attempts) |
| 401    | `invalid-token`     | Unknown, used, or revoked refresh token       |
| 404    | `user-not-found`    | Login for a phone with no account: the code is kept, send it to `/auth/register` |
| 409    | `user-phone-exist`  | Register for a phone that already has an account |
| 422    | `unprocessable-entity` | Invalid phone or code format               |
| 429    | `too-many-requests` | Code requested less than 60 seconds ago       |
| 503    | `service-unavailable` | Code delivery is not available outside dev  |
