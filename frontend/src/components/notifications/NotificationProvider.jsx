import { useEffect } from 'react'
import {
  NotificationsProvider as ReapopProvider,
  useNotifications,
} from 'reapop'
import {
  configureNotifications,
  registerNotificationDispatcher,
  unregisterNotificationDispatcher,
  notify,
} from '../../services/notifications'
import NotificationSystem from './NotificationSystem'

configureNotifications()

const NETWORK_NOTIFICATION_ID = 'network-connectivity'

function NotificationDispatcherBridge() {
  const { notify: reapop_notify, dismissNotification, dismissNotifications } = useNotifications()

  useEffect(() => {
    registerNotificationDispatcher({
      notify: reapop_notify,
      dismissNotification,
      dismissNotifications,
    })
    return () => {
      unregisterNotificationDispatcher()
    }
  }, [reapop_notify, dismissNotification, dismissNotifications])

  useEffect(() => {
    const handle_offline = () => {
      notify.warning({
        id: NETWORK_NOTIFICATION_ID,
        title: 'Connection lost',
        message: 'You are currently offline. Checking your internet connection…',
        dismissible: false,
        showDismissButton: false,
        dismissAfter: 0,
        allowDuplicate: true,
      })
    }

    const handle_online = () => {
      notify.update(NETWORK_NOTIFICATION_ID, {
        status: 'success',
        title: 'Back online',
        message: 'Internet connection has been restored.',
        dismissible: true,
        showDismissButton: true,
        dismissAfter: 3000,
      })
    }

    window.addEventListener('offline', handle_offline)
    window.addEventListener('online', handle_online)

    return () => {
      window.removeEventListener('offline', handle_offline)
      window.removeEventListener('online', handle_online)
    }
  }, [])

  return null
}

export default function NotificationProvider({ children }) {
  return (
    <ReapopProvider>
      <NotificationDispatcherBridge />
      {children}
      <NotificationSystem />
    </ReapopProvider>
  )
}

