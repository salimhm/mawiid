import { create_email_client } from '@module/main/email/email.service'

try {
  const email = create_email_client()
  await email.verify()
  console.log('SMTP connection and authentication succeeded. No email was sent.')
} catch {
  console.error('SMTP check failed. Check SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_FROM and GOOGLE_APP_PASSWORD.')
  process.exitCode = 1
}
