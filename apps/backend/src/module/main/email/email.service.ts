import nodemailer, { type Transporter } from 'nodemailer'
import { lib_error } from '@lib/error.lib'

type email_message = {
  user_email: string
  purpose: 'email_verification' | 'password_reset'
  link: string
  expires_in: number
}

const templates = {
  email_verification: { subject: 'Verify your Mawiid email', action: 'Verify your email address to finish creating your Mawiid account.' },
  password_reset: { subject: 'Reset your Mawiid password', action: 'Use this link to choose a new password for your Mawiid account.' },
  password_changed: { subject: 'Your Mawiid password was changed', action: 'Your Mawiid password has been changed. Please sign in again. If you did not make this change, contact Mawiid support immediately.' },
}

export function create_email_client(): Transporter {
  const port = Number(process.env.SMTP_PORT)
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_FROM || !process.env.GOOGLE_APP_PASSWORD || ![465, 587].includes(port)) {
    throw lib_error.email_unavailable
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.GOOGLE_APP_PASSWORD.replace(/\s/g, '') },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  }, { from: process.env.SMTP_FROM })
}

export const service_email = {
  async create_notification(user_email: string, email: Pick<Transporter, 'sendMail'> = create_email_client()) {
    try {
      const result = await email.sendMail({ to: user_email, subject: templates.password_changed.subject, text: templates.password_changed.action })
      if (result.rejected?.length) throw lib_error.email_unavailable
      return { message_id: result.messageId }
    } catch {
      throw lib_error.email_unavailable
    }
  },

  async create(body: email_message, email: Pick<Transporter, 'sendMail'> = create_email_client()) {
    const template = templates[body.purpose]
    const duration = body.expires_in % 3600 === 0 ? `${body.expires_in / 3600} hours` : `${Math.ceil(body.expires_in / 60)} minutes`
    try {
      const result = await email.sendMail({
        to: body.user_email,
        subject: template.subject,
        text: `${template.action}\n\n${body.link}\n\nThis link expires in ${duration}.\n\nIf you did not request this, you can ignore this email.`,
      })
      if (result.rejected?.length) throw lib_error.email_unavailable
      return { message_id: result.messageId }
    } catch {
      throw lib_error.email_unavailable
    }
  },
}
