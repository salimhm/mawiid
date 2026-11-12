let counter = 0
const recent_keys = new Map()
const DEFAULT_DEDUP_WINDOW_MS = 1500

export const generateNotificationId = (prefix = 'mawiid-notif') => {
  counter = (counter + 1) % 1000000
  return `${prefix}-${Date.now()}-${counter}`
}

export const isDuplicateNotification = (key, window_ms = DEFAULT_DEDUP_WINDOW_MS) => {
  if (!key)
    return false

  const now = Date.now()
  const last_seen = recent_keys.get(key)

  if (last_seen && now - last_seen < window_ms)
    return true

  recent_keys.set(key, now)

  if (recent_keys.size > 200) {
    for (const [k, ts] of recent_keys.entries()) {
      if (now - ts > 10000)
        recent_keys.delete(k)
    }
  }

  return false
}

export const clearDuplicateCache = () => {
  recent_keys.clear()
}

export const normalizeNotificationPayload = (message_or_options, maybe_options = {}, default_status = 'none') => {
  let title = ''
  let message = ''
  let options = {}

  if (typeof message_or_options === 'string') {
    message = message_or_options
    options = maybe_options || {}
    title = options.title || ''
  } else if (message_or_options && typeof message_or_options === 'object') {
    options = { ...message_or_options, ...maybe_options }
    title = options.title || ''
    message = options.message || ''
  }

  const status = options.status || default_status
  const id = options.id || generateNotificationId(status)
  const buttons = Array.isArray(options.buttons) ? options.buttons : []
  const dismissible = options.dismissible !== undefined ? options.dismissible : true
  const showDismissButton = options.showDismissButton !== undefined ? options.showDismissButton : true

  return {
    ...options,
    id,
    title,
    message,
    status,
    buttons,
    dismissible,
    showDismissButton,
  }
}

