const is_dev = typeof process !== 'undefined'
  ? process.env.NODE_ENV !== 'production'
  : true

const sanitize_meta = (meta) => {
  if (!meta || typeof meta !== 'object')
    return meta

  const sensitive_keys = new Set([
    'password',
    'user_password',
    'confirm',
    'token',
    'access_token',
    'refresh_token',
    'authorization',
    'secret',
    'otp',
    'otp_code',
  ])

  const clean = Array.isArray(meta) ? [] : {}
  for (const [key, value] of Object.entries(meta)) {
    if (sensitive_keys.has(String(key).toLowerCase()))
      clean[key] = '[REDACTED]'
    else if (value && typeof value === 'object')
      clean[key] = sanitize_meta(value)
    else
      clean[key] = value
  }
  return clean
}

export const logger = {
  debug: (tag, message, meta) => {
    if (!is_dev) return
    console.debug(`[Mawiid:${tag}] ${message}`, meta ? sanitize_meta(meta) : '')
  },
  info: (tag, message, meta) => {
    if (!is_dev) return
    console.info(`[Mawiid:${tag}] ${message}`, meta ? sanitize_meta(meta) : '')
  },
  warn: (tag, message, meta) => {
    console.warn(`[Mawiid:${tag}] ${message}`, meta ? sanitize_meta(meta) : '')
  },
  error: (tag, message, error, meta) => {
    console.error(
      `[Mawiid:${tag}] ${message}`,
      error?.message || error || '',
      meta ? sanitize_meta(meta) : ''
    )
  },
}

