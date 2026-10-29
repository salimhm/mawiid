import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import nodemailer from 'nodemailer'
import type StreamTransport from 'nodemailer/lib/stream-transport'
import { lib_error } from '@lib/error.lib'
import { create_email_client, service_email } from '@module/main/email/email.service'

const settings = {
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '465',
  SMTP_USER: 'contact@example.com',
  SMTP_FROM: 'contact@example.com',
  GOOGLE_APP_PASSWORD: 'abcd efgh ijkl mnop',
}
const previous_env = { ...process.env }

beforeEach(() => Object.assign(process.env, settings))
afterEach(() => {
  for (const key of Object.keys(settings)) {
    if (previous_env[key] === undefined) delete process.env[key]
    else process.env[key] = previous_env[key]
  }
})

describe('SMTP configuration', () => {
  test.each([465, 587])('requires encrypted delivery on port %s', (port) => {
    process.env.SMTP_PORT = String(port)
    const transport_spy = spyOn(nodemailer, 'createTransport')
    const email = create_email_client()
    try {
      expect(transport_spy).toHaveBeenCalledWith({
        host: settings.SMTP_HOST,
        port,
        secure: port === 465,
        requireTLS: true,
        auth: { user: settings.SMTP_USER, pass: 'abcdefghijklmnop' },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
      }, { from: settings.SMTP_FROM })
    } finally {
      email.close()
      transport_spy.mockRestore()
    }
  })

  test.each(Object.keys(settings))('rejects missing %s without connecting', async (key) => {
    delete process.env[key]
    await expect(Promise.resolve().then(create_email_client)).rejects.toEqual(lib_error.email_unavailable)
  })

  test.each(['invalid', '25'])('rejects unsupported SMTP port %s', async (port) => {
    process.env.SMTP_PORT = port
    await expect(Promise.resolve().then(create_email_client)).rejects.toEqual(lib_error.email_unavailable)
  })
})

describe('auth email delivery', () => {
  test('builds a password-changed notification without a password or reset link', async () => {
    const email = nodemailer.createTransport({ streamTransport: true, buffer: true }, { from: settings.SMTP_FROM })
    const send_spy = spyOn(email, 'sendMail')
    try {
      await service_email.create_notification('user@example.com', email)
      const sent = await send_spy.mock.results[0]!.value as StreamTransport.SentMessageInfo
      const message = sent.message.toString()
      expect(message).toContain('Subject: Your Mawiid password was changed')
      expect(message).toContain('Please sign in again.')
      expect(message).toContain('contact Mawiid support immediately')
      expect(message).not.toContain('token=')
      expect(message).not.toContain('you can ignore')
    } finally {
      send_spy.mockRestore()
      email.close()
    }
  })

  test.each([
    ['email_verification', 'Verify your Mawiid email', 86400, '24 hours'],
    ['password_reset', 'Reset your Mawiid password', 1800, '30 minutes'],
  ] as const)('builds a real %s email without a network connection', async (purpose, subject, expires_in, duration) => {
    const email = nodemailer.createTransport({ streamTransport: true, buffer: true }, { from: settings.SMTP_FROM })
    const send_spy = spyOn(email, 'sendMail')
    const link = 'https://mawiid.example/auth/action?token=test-token'
    try {
      const result = await service_email.create({ user_email: 'user@example.com', purpose, link, expires_in }, email)
      const sent = await send_spy.mock.results[0]!.value as StreamTransport.SentMessageInfo
      const message = sent.message.toString()

      expect(result.message_id).toBe(sent.messageId)
      expect(sent.envelope).toEqual({ from: settings.SMTP_FROM, to: ['user@example.com'] })
      expect(message).toContain(`From: ${settings.SMTP_FROM}`)
      expect(message).toContain(`Subject: ${subject}`)
      expect(message).toContain(link)
      expect(message).toContain(`This link expires in ${duration}.`)
      expect(message).toContain('If you did not request this')
      expect(message).not.toContain(settings.GOOGLE_APP_PASSWORD)
    } finally {
      send_spy.mockRestore()
      email.close()
    }
  })

  test('returns a safe error on SMTP failure without logging provider details', async () => {
    const email = { sendMail: async () => { throw new Error('Private SMTP failure details') } }
    const error_spy = spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(service_email.create({
        user_email: 'user@example.com', purpose: 'password_reset', link: 'https://mawiid.example/reset', expires_in: 1800,
      }, email)).rejects.toEqual(lib_error.email_unavailable)
      expect(error_spy).not.toHaveBeenCalled()
    } finally {
      error_spy.mockRestore()
    }
  })

  test('treats a rejected recipient as a delivery failure', async () => {
    const email = { sendMail: async () => ({ messageId: 'test', envelope: { from: settings.SMTP_FROM, to: ['user@example.com'] }, rejected: ['user@example.com'] }) }
    await expect(service_email.create({
      user_email: 'user@example.com', purpose: 'email_verification', link: 'https://mawiid.example/verify', expires_in: 86400,
    }, email)).rejects.toEqual(lib_error.email_unavailable)
  })
})
