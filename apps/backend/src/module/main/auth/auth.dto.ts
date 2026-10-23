import { t } from 'elysia'

const dto_auth_phone = t.String({ pattern: '^\\+[1-9][0-9]{7,14}$' })
const dto_auth_otp_code = t.String({ pattern: '^[0-9]{6}$' })
const dto_auth_refresh_token = t.String({ minLength: 1, maxLength: 128 })

export const dto_schema_auth_user = t.Object({
  user_id: t.Number(),
  user_phone: t.String(),
  user_first_name: t.String(),
  user_last_name: t.String(),
  user_image: t.Nullable(t.String()),
  user_language: t.Nullable(t.String()),
  created_at: t.Date(),
})

export const dto_schema_auth_session = t.Object({
  access_token: t.String(),
  refresh_token: t.String(),
  expires_in: t.Number(),
  user: dto_schema_auth_user,
})

export const dto_auth = {
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
  login: {
    body: t.Object({
      user_phone: dto_auth_phone,
      otp_code: dto_auth_otp_code,
    }),
    response: t.Object({
      data: dto_schema_auth_session,
    }),
  },
  register: {
    body: t.Object({
      user_phone: dto_auth_phone,
      otp_code: dto_auth_otp_code,
      user_first_name: t.String({ minLength: 1, maxLength: 64 }),
      user_last_name: t.String({ minLength: 1, maxLength: 64 }),
      user_language: t.Optional(t.String({ minLength: 2, maxLength: 16 })),
    }),
    response: t.Object({
      data: dto_schema_auth_session,
    }),
  },
  refresh: {
    body: t.Object({
      refresh_token: dto_auth_refresh_token,
    }),
    response: t.Object({
      data: dto_schema_auth_session,
    }),
  },
  logout: {
    body: t.Object({
      refresh_token: dto_auth_refresh_token,
    }),
    response: t.Object({
      data: t.Object({
        logged_out: t.Boolean(),
      }),
    }),
  },
}
