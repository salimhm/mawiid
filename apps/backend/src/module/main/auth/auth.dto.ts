import { t } from 'elysia'

export const dto_auth_refresh_cookie = '__Host-mawiid_refresh'

const dto_auth_phone = t.String({ pattern: '^\\+[1-9][0-9]{7,14}$' })
const dto_auth_otp_code = t.String({ pattern: '^[0-9]{6}$' })
const dto_auth_username = t.String({ pattern: '^[A-Za-z0-9_]{3,32}$' })
const dto_auth_email = t.String({ format: 'email', maxLength: 254 })
const dto_auth_password = t.String({ minLength: 8, maxLength: 128 })
const dto_auth_first_name = t.String({ minLength: 1, maxLength: 64 })
const dto_auth_last_name = t.String({ minLength: 1, maxLength: 64 })
const dto_auth_language = t.String({ minLength: 2, maxLength: 16 })
const dto_auth_cookie = t.Cookie({
  [dto_auth_refresh_cookie]: t.Optional(t.String({ maxLength: 128 })),
})

export const dto_schema_auth_user = t.Object({
  user_id: t.Number(),
  user_phone: t.Nullable(t.String()),
  user_username: t.Nullable(t.String()),
  user_email: t.Nullable(t.String()),
  user_first_name: t.String(),
  user_last_name: t.String(),
  user_image: t.Nullable(t.String()),
  user_language: t.Nullable(t.String()),
  created_at: t.Date(),
})

export const dto_schema_auth_session = t.Object({
  access_token: t.String(),
  expires_in: t.Number(),
  user: dto_schema_auth_user,
})

const dto_auth_session_response = t.Object({
  data: dto_schema_auth_session,
})

export const dto_auth = {
  register: {
    body: t.Object({
      user_username: dto_auth_username,
      user_email: dto_auth_email,
      user_password: dto_auth_password,
      user_first_name: dto_auth_first_name,
      user_last_name: dto_auth_last_name,
      user_language: t.Optional(dto_auth_language),
    }),
    response: dto_auth_session_response,
  },
  login: {
    body: t.Object({
      user_identifier: t.String({ minLength: 3, maxLength: 254 }),
      user_password: dto_auth_password,
    }),
    response: dto_auth_session_response,
  },
  otp: {
    body: t.Object({
      user_phone: dto_auth_phone,
    }),
    response: t.Object({
      data: t.Object({
        expires_in: t.Number(),
        otp_code: t.Optional(t.String()),
      }),
    }),
  },
  otp_login: {
    body: t.Object({
      user_phone: dto_auth_phone,
      otp_code: dto_auth_otp_code,
    }),
    response: dto_auth_session_response,
  },
  otp_register: {
    body: t.Object({
      user_phone: dto_auth_phone,
      otp_code: dto_auth_otp_code,
      user_first_name: dto_auth_first_name,
      user_last_name: dto_auth_last_name,
      user_language: t.Optional(dto_auth_language),
    }),
    response: dto_auth_session_response,
  },
  refresh: {
    cookie: dto_auth_cookie,
    response: dto_auth_session_response,
  },
  logout: {
    cookie: dto_auth_cookie,
    response: t.Object({
      data: t.Object({
        logged_out: t.Boolean(),
      }),
    }),
  },
}
