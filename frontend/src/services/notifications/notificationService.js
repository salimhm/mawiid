import { useNotifications } from 'reapop'
import {
  NOTIFICATION_DURATIONS,
  NOTIFICATION_STATUS,
} from './notificationConfig'
import {
  NOTIFICATION_TITLES,
  resolveErrorMessage,
} from './notificationMessages'
import {
  generateNotificationId,
  isDuplicateNotification,
  normalizeNotificationPayload,
} from './notificationUtils'
import { logger } from './logger'

let active_dispatcher = null
const queued_actions = []

export const registerNotificationDispatcher = (dispatcher) => {
  active_dispatcher = dispatcher
  while (queued_actions.length > 0) {
    const action = queued_actions.shift()
    try {
      action(active_dispatcher)
    } catch (err) {
      logger.error('Service', 'Failed to dispatch queued notification', err)
    }
  }
}

export const unregisterNotificationDispatcher = () => {
  active_dispatcher = null
}

const dispatch_action = (handler) => {
  if (active_dispatcher) {
    return handler(active_dispatcher)
  }
  queued_actions.push(handler)
  return null
}

const create_notification_invoker = (status) => (message_or_options, maybe_options = {}) => {
  const payload = normalizeNotificationPayload(
    message_or_options,
    maybe_options,
    status
  )

  const dedup_key = payload.dedupKey ?? `${payload.status}:${payload.title}:${payload.message}`
  if (!payload.allowDuplicate && isDuplicateNotification(dedup_key)) {
    return payload.id
  }

  const title = payload.title || (status === 'none' ? '' : NOTIFICATION_TITLES[status] || '')
  const dismiss_after = payload.dismissAfter !== undefined
    ? payload.dismissAfter
    : status === 'error'
      ? NOTIFICATION_DURATIONS.long
      : status === 'loading'
        ? NOTIFICATION_DURATIONS.persistent
        : NOTIFICATION_DURATIONS.default

  const normalized = {
    ...payload,
    title,
    dismissAfter: dismiss_after,
  }

  logger.debug('Notify', `[${status.toUpperCase()}] ${title}: ${normalized.message}`, { id: normalized.id })

  dispatch_action((dispatcher) => {
    dispatcher.notify(normalized)
  })

  return normalized.id
}

export const notify = {
  success: create_notification_invoker(NOTIFICATION_STATUS.success),
  error: (error_or_message, maybe_options = {}) => {
    let message = ''
    let options = maybe_options

    if (error_or_message instanceof Error || (error_or_message && typeof error_or_message === 'object' && ('code' in error_or_message || 'status' in error_or_message))) {
      message = resolveErrorMessage(error_or_message)
      if (typeof maybe_options === 'object') {
        options = { ...maybe_options }
      }
    } else if (typeof error_or_message === 'string') {
      message = error_or_message
    } else if (error_or_message && typeof error_or_message === 'object') {
      options = { ...error_or_message, ...maybe_options }
      message = options.message || resolveErrorMessage(options.error)
    }

    return create_notification_invoker(NOTIFICATION_STATUS.error)(message, options)
  },
  warning: create_notification_invoker(NOTIFICATION_STATUS.warning),
  info: create_notification_invoker(NOTIFICATION_STATUS.info),
  loading: (message_or_options, maybe_options = {}) => {
    const options = typeof message_or_options === 'string'
      ? { ...maybe_options, message: message_or_options }
      : { ...message_or_options, ...maybe_options }

    return create_notification_invoker(NOTIFICATION_STATUS.loading)({
      dismissible: false,
      showDismissButton: false,
      dismissAfter: NOTIFICATION_DURATIONS.persistent,
      ...options,
    })
  },
  none: create_notification_invoker(NOTIFICATION_STATUS.none),
  neutral: create_notification_invoker(NOTIFICATION_STATUS.none),

  dismiss: (id) => {
    if (!id) return
    dispatch_action((dispatcher) => {
      dispatcher.dismissNotification(id)
    })
  },

  dismissAll: () => {
    dispatch_action((dispatcher) => {
      dispatcher.dismissNotifications()
    })
  },

  update: (id, updates = {}) => {
    if (!id) return id
    const current_status = updates.status || NOTIFICATION_STATUS.none
    const title = updates.title !== undefined
      ? updates.title
      : NOTIFICATION_TITLES[current_status] || ''

    const payload = {
      ...updates,
      id,
      title,
      status: current_status,
      dismissAfter: updates.dismissAfter !== undefined
        ? updates.dismissAfter
        : current_status === 'error'
          ? NOTIFICATION_DURATIONS.long
          : current_status === 'loading'
            ? NOTIFICATION_DURATIONS.persistent
            : NOTIFICATION_DURATIONS.default,
      dismissible: updates.dismissible !== undefined
        ? updates.dismissible
        : current_status !== 'loading',
      showDismissButton: updates.showDismissButton !== undefined
        ? updates.showDismissButton
        : current_status !== 'loading',
    }

    dispatch_action((dispatcher) => {
      dispatcher.notify(payload)
    })

    return id
  },

  promise: async (promise, messages = {}, options = {}) => {
    const loading_id = options.id || generateNotificationId('promise')
    const loading_message = messages.loading || 'Processing request…'
    const loading_title = messages.loadingTitle || NOTIFICATION_TITLES.loading

    notify.loading({
      id: loading_id,
      title: loading_title,
      message: loading_message,
      allowDuplicate: true,
      ...options,
    })

    try {
      const result = await (typeof promise === 'function' ? promise() : promise)
      const success_message = typeof messages.success === 'function'
        ? messages.success(result)
        : (messages.success || 'Completed successfully')
      const success_title = messages.successTitle || NOTIFICATION_TITLES.success

      notify.update(loading_id, {
        status: NOTIFICATION_STATUS.success,
        title: success_title,
        message: success_message,
        dismissible: true,
        showDismissButton: true,
        dismissAfter: options.successDuration || NOTIFICATION_DURATIONS.default,
      })

      return result
    } catch (error) {
      const error_message = typeof messages.error === 'function'
        ? messages.error(error)
        : (messages.error || resolveErrorMessage(error))
      const error_title = messages.errorTitle || NOTIFICATION_TITLES.error

      notify.update(loading_id, {
        status: NOTIFICATION_STATUS.error,
        title: error_title,
        message: error_message,
        dismissible: true,
        showDismissButton: true,
        dismissAfter: options.errorDuration || NOTIFICATION_DURATIONS.long,
      })

      throw error
    }
  },
}

export const useNotify = () => {
  let notifications = []
  try {
    const context = useNotifications()
    notifications = context?.notifications || []
  } catch {
    notifications = []
  }
  return {
    ...notify,
    notifications,
  }
}

