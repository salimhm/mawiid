# Email implementation

## Implemented

- Internal SMTP email delivery through Nodemailer.
- Plain-text email-verification and password-reset templates with the supplied link and expiry.
- The sender comes from `SMTP_FROM`; SMTP authentication uses `SMTP_USER` and `GOOGLE_APP_PASSWORD`.
- Port 465 uses TLS from connection start. Port 587 requires a successful STARTTLS upgrade. Other ports are rejected.
- Missing configuration and delivery failures raise `{ status: 503, code: 'email-unavailable' }`. Credentials, provider errors and email contents are not logged.
- A connection/authentication check that sends no message.
- Registration and verification resend are connected to the email service. The user confirmed receiving the registration verification email on 2026-10-28.
- Password-reset requests are connected to the existing reset template through `POST /auth/password/forgot`.
- `service_email.create_notification(user_email)` sends a password-changed confirmation after a successful reset, with no password or reset token.

## Configuration

Use the root `.env`:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=contact@your-domain.com
SMTP_FROM=contact@your-domain.com
GOOGLE_APP_PASSWORD=your-google-app-password
```

Use the actual account and authorized sender configured with Google. Spaces copied between App Password groups are removed before authentication. SMTP settings are checked when the email client is created, so unrelated existing endpoints do not require an SMTP connection at startup. There are no additional environment variables in this step.

## Internal service contract

There are no HTTP endpoints or public permissions in this module. Password registration, verification resend and password-reset requests call `service_email.create` after validating the auth operation and generating a token. The caller builds links from `PUBLIC_APP_URL`; request bodies do not control the sender or destination link.

Example verification email:

```typescript
await service_email.create({
  user_email: 'user@example.com',
  purpose: 'email_verification',
  link: 'https://your-app.example/auth/verify-email?token=generated-token',
  expires_in: 86400,
})
```

Expected: `{ message_id: '<provider-message-id>' }`, subject `Verify your Mawiid email`, the supplied link and a 24-hour expiry notice.

Example password-reset email:

```typescript
await service_email.create({
  user_email: 'user@example.com',
  purpose: 'password_reset',
  link: 'https://your-app.example/auth/reset-password?token=generated-token',
  expires_in: 1800,
})
```

Expected: `{ message_id: '<provider-message-id>' }`, subject `Reset your Mawiid password`, the supplied link and a 30-minute expiry notice.

These example URLs describe the intended links; their routes are not implemented by this step. A returned message ID means SMTP accepted the message, not that inbox delivery has been confirmed. A rejected recipient or SMTP failure raises `email-unavailable`.

## Testing

From `apps/backend`:

```bash
bun run email:check
```

Expected successful output:

```text
SMTP connection and authentication succeeded. No email was sent.
```

Failure exits with code 1 and a generic configuration-check message. The command does not send an email or verify whether Google will accept a particular From address. The configured Google account passed connection/authentication verification during implementation on 2026-10-28; no real email was sent.

```bash
bun test src/module/main/email/email.test.ts
bun run typecheck
```

Tests build real email messages using Nodemailer's in-memory stream transport. They check sender, recipient, subjects, links, expiry, SMTP configuration, missing settings, rejected recipients and safe failure handling. They do not connect to Gmail or send mail.

## Password-changed confirmation

After committing the reset, auth calls `service_email.create_notification(user_email)`. Subject: `Your Mawiid password was changed`. The message asks the user to sign in again and contact support if the change was not theirs.

If notification fails, the reset still succeeds with `notification_sent: false` and a generic server log. The new password remains effective and the consumed token cannot be retried. A dedicated in-memory message test covers this notification.

## Still missing

- Add broader IP limits as part of auth hardening. Registration/resend already enforce a shared per-address cooldown, replacement tokens and cleanup after delivery failures.

Frontend pages and links are deferred until the backend auth flow is complete.
