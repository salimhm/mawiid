import { describe, it, expect, beforeEach } from 'bun:test'
import {
  resolveErrorMessage,
  HTTP_ERROR_MESSAGES,
  DOMAIN_ERROR_MESSAGES,
  MEDIA_ERROR_MESSAGES,
} from './notificationMessages'
import {
  generateNotificationId,
  isDuplicateNotification,
  clearDuplicateCache,
  normalizeNotificationPayload,
} from './notificationUtils'
import {
  notify,
  registerNotificationDispatcher,
  unregisterNotificationDispatcher,
} from './notificationService'
import { mawiidTheme } from './notificationTheme'

describe('Notification Error Normalization', () => {
  it('resolves domain error codes to user-friendly messages', () => {
    expect(resolveErrorMessage('invalid-credentials')).toBe(DOMAIN_ERROR_MESSAGES['invalid-credentials'])
    expect(resolveErrorMessage({ code: 'forbidden' })).toBe(DOMAIN_ERROR_MESSAGES['forbidden'])
    expect(resolveErrorMessage({ code: 'room-not-found' })).toBe(DOMAIN_ERROR_MESSAGES['room-not-found'])
  })

  it('resolves HTTP status codes to meaningful explanations', () => {
    expect(resolveErrorMessage({ status: 401 })).toBe(HTTP_ERROR_MESSAGES[401])
    expect(resolveErrorMessage({ status: 404 })).toBe(HTTP_ERROR_MESSAGES[404])
    expect(resolveErrorMessage({ status: 429 })).toBe(HTTP_ERROR_MESSAGES[429])
    expect(resolveErrorMessage({ status: 500 })).toBe(HTTP_ERROR_MESSAGES[500])
  })

  it('resolves browser media and device errors', () => {
    const error = new Error('Permission denied')
    error.name = 'NotAllowedError'
    expect(resolveErrorMessage(error)).toBe(MEDIA_ERROR_MESSAGES.NotAllowedError)
  })

  it('falls back to error message or default text gracefully', () => {
    expect(resolveErrorMessage(new Error('Custom network issue'))).toBe('Custom network issue')
    expect(resolveErrorMessage(null)).toBe('Something went wrong. Please try again.')
    expect(resolveErrorMessage({}, 'Custom fallback')).toBe('Custom fallback')
  })
})

describe('Notification Utilities', () => {
  beforeEach(() => {
    clearDuplicateCache()
  })

  it('generates unique notification IDs with prefix', () => {
    const id1 = generateNotificationId('test')
    const id2 = generateNotificationId('test')
    expect(id1).toContain('test-')
    expect(id1).not.toBe(id2)
  })

  it('prevents duplicate notifications within the debounce window', () => {
    const key = 'test:duplicate:key'
    expect(isDuplicateNotification(key, 500)).toBe(false)
    expect(isDuplicateNotification(key, 500)).toBe(true)
  })

  it('normalizes string and object payloads properly', () => {
    const payloadFromString = normalizeNotificationPayload('Profile updated', { title: 'Saved' }, 'success')
    expect(payloadFromString.message).toBe('Profile updated')
    expect(payloadFromString.title).toBe('Saved')
    expect(payloadFromString.status).toBe('success')
    expect(payloadFromString.dismissible).toBe(true)

    const payloadFromObject = normalizeNotificationPayload({ title: 'Alert', message: 'Low battery', status: 'warning' })
    expect(payloadFromObject.title).toBe('Alert')
    expect(payloadFromObject.message).toBe('Low battery')
    expect(payloadFromObject.status).toBe('warning')
  })
})

describe('Notification Service & Promise Handling', () => {
  let dispatched = []
  let dismissed = []
  let allDismissed = false

  beforeEach(() => {
    dispatched = []
    dismissed = []
    allDismissed = false
    clearDuplicateCache()
    registerNotificationDispatcher({
      notify: (payload) => {
        dispatched.push(payload)
        return payload
      },
      dismissNotification: (id) => {
        dismissed.push(id)
      },
      dismissNotifications: () => {
        allDismissed = true
      },
    })
  })

  it('dispatches success, error, warning, and info notifications', () => {
    notify.success('Account created successfully')
    notify.error('Unable to connect')
    notify.warning('Internet unstable')
    notify.info('Meeting is starting')

    expect(dispatched.length).toBe(4)
    expect(dispatched[0].status).toBe('success')
    expect(dispatched[0].message).toBe('Account created successfully')
    expect(dispatched[1].status).toBe('error')
    expect(dispatched[2].status).toBe('warning')
    expect(dispatched[3].status).toBe('info')
  })

  it('handles dismiss and dismissAll calls', () => {
    notify.dismiss('item-123')
    expect(dismissed).toContain('item-123')

    notify.dismissAll()
    expect(allDismissed).toBe(true)
  })

  it('handles notify.promise with resolution', async () => {
    const promise = Promise.resolve({ room_uid: 'abc-123' })
    const result = await notify.promise(promise, {
      loading: 'Creating room…',
      success: 'Room ready!',
      error: 'Failed to create room',
    })

    expect(result).toEqual({ room_uid: 'abc-123' })
    expect(dispatched.length).toBe(2)
    expect(dispatched[0].status).toBe('loading')
    expect(dispatched[0].message).toBe('Creating room…')
    expect(dispatched[1].status).toBe('success')
    expect(dispatched[1].message).toBe('Room ready!')
    expect(dispatched[0].id).toBe(dispatched[1].id)
  })

  it('handles notify.promise with rejection', async () => {
    const failingPromise = Promise.reject(new Error('Server unavailable'))

    await expect(
      notify.promise(failingPromise, {
        loading: 'Connecting…',
        success: 'Connected',
        error: 'Connection rejected',
      })
    ).rejects.toThrow('Server unavailable')

    expect(dispatched.length).toBe(2)
    expect(dispatched[0].status).toBe('loading')
    expect(dispatched[1].status).toBe('error')
    expect(dispatched[1].message).toBe('Connection rejected')
    expect(dispatched[0].id).toBe(dispatched[1].id)
  })
})

describe('Mawiid Theme', () => {
  it('applies dark glassmorphic styling and status borders', () => {
    const successStyle = mawiidTheme.notification({ status: 'success' })
    expect(successStyle.borderLeft).toContain('#22c55e')
    expect(successStyle.backgroundColor).toBe('rgba(18, 18, 22, 0.94)')

    const errorStyle = mawiidTheme.notification({ status: 'error' })
    expect(errorStyle.borderLeft).toContain('#ef4444')

    const containerStyle = mawiidTheme.container('top-right', false)
    expect(containerStyle.position).toBe('fixed')
    expect(containerStyle.zIndex).toBe(999999)
  })
})

