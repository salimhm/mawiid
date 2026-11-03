import { t } from 'elysia'

export const dto_auth_refresh_cookie = '__Host-mawiid_refresh'

const dto_auth_phone = t.String({ pattern: '^\\+[1-9][0-9]{7,14}$', error: 'Enter a valid phone number including the country code.' })
const dto_auth_otp_code = t.String({ pattern: '^[0-9]{6}$', error: 'Enter the 6-digit verification code.' })
const dto_auth_username = t.String({ pattern: '^[A-Za-z0-9_]{3,32}$', error: 'Username must contain 3–32 letters, numbers or underscores.' })
const dto_auth_email = t.String({ format: 'email', maxLength: 254, error: 'Enter a valid email address.' })
const dto_auth_password = t.String({ minLength: 8, maxLength: 128, error: 'Password must contain 8–128 characters.' })
const dto_auth_first_name = t.String({ minLength: 1, maxLength: 64, error: 'First name must contain 1–64 characters.' })
const dto_auth_last_name = t.String({ minLength: 1, maxLength: 64, error: 'Last name must contain 1–64 characters.' })
const dto_auth_language = t.String({ minLength: 2, maxLength: 16, error: 'Choose a valid language.' })
const dto_auth_cookie = t.Cookie({
  [dto_auth_refresh_cookie]: t.Optional(t.String({ maxLength: 128 })),
})

export const dto_schema_auth_user = t.Object({
  user_id: t.Number(),
  user_phone: t.Nullable(t.String()),
  user_username: t.Nullable(t.String()),
  user_email: t.Nullable(t.String()),
  user_email_verified_at: t.Nullable(t.Date()),
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
  reset_password: {
    body: t.Object({
      token: t.String({ pattern: '^[A-Za-z0-9_-]{43}$', error: 'This password reset link is invalid.' }),
      user_password: dto_auth_password,
    }),
    response: t.Object({ data: t.Object({ password_reset: t.Literal(true), notification_sent: t.Boolean() }) }),
    detail: {
      tags: ['auth'],
      summary: 'Reset my password',
      description: 'Consumes a 30-minute password-reset token, changes the password, invalidates older sessions and attempts a confirmation email. Does not sign in. A failed confirmation email returns success with notification_sent false.',
    },
  },
  forgot_password: {
    body: t.Object({ user_email: dto_auth_email }),
    response: t.Object({ data: t.Object({ message: t.String() }) }),
    detail: {
      tags: ['auth'],
      summary: 'Request a password reset',
      description: 'Emails a 30-minute single-use reset link for an active, verified password account. No login required. Returns the same confirmation for ineligible accounts. Limited to one request per address per minute; a new link replaces previous reset links.',
    },
  },
  resend_email: {
    body: t.Object({ user_email: dto_auth_email }),
    response: t.Object({ data: t.Object({ message: t.String() }) }),
    detail: {
      tags: ['auth'],
      summary: 'Resend my verification email',
      description: 'Sends a new 24-hour link for an unverified account and replaces previous links. No login required. Uses the same response for unknown or already verified addresses. Limited to one email request per address per minute, shared with registration.',
    },
  },
  verify_email: {
    body: t.Object({
      token: t.String({ pattern: '^[A-Za-z0-9_-]{43}$', error: 'This verification link is invalid.' }),
    }),
    response: t.Object({
      data: t.Object({ email_verified: t.Literal(true) }),
    }),
    detail: {
      tags: ['auth'],
      summary: 'Verify my email',
      description: 'Consumes a single-use email verification token. No login required. Invalid, expired, used or stale links return 401.',
    },
  },
  register: {
    body: t.Object({
      user_username: dto_auth_username,
      user_email: dto_auth_email,
      user_password: dto_auth_password,
      user_first_name: dto_auth_first_name,
      user_last_name: dto_auth_last_name,
      user_language: t.Optional(dto_auth_language),
    }),
    response: t.Object({
      data: t.Object({
        verification_sent: t.Literal(true),
        expires_in: t.Number(),
      }),
    }),
    detail: {
      tags: ['auth'],
      summary: 'Create an account and send a verification email',
      description: 'Creates an unverified account and emails a single-use verification link. Does not issue a session. Email requests are limited to one per address per minute.',
    },
  },
  login: {
    body: t.Object({
      user_identifier: t.String({ minLength: 3, maxLength: 254, error: 'Enter your username or email.' }),
      user_password: dto_auth_password,
    }),
    response: dto_auth_session_response,
    detail: {
      tags: ['auth'],
      summary: 'Sign in with my password',
      description: 'Requires a verified email after credentials are checked. Unverified accounts return 403 email-not-verified; incorrect credentials return 401 invalid-credentials.',
    },
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
    detail: {
      tags: ['auth'],
      summary: 'Refresh my session',
      description: 'Rotates the refresh cookie. Unverified password accounts return 403 email-not-verified and lose their refresh family. Phone-only OTP accounts do not require email verification.',
    },
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
