import ReapopNotificationsSystem, {
  useNotifications,
  SlideTransition,
} from 'reapop'
import { mawiidTheme } from '../../services/notifications/notificationTheme'

export default function NotificationSystem() {
  const { notifications, dismissNotification } = useNotifications()

  return (
    <ReapopNotificationsSystem
      notifications={notifications}
      dismissNotification={dismissNotification}
      theme={mawiidTheme}
      components={{
        Transition: SlideTransition,
      }}
      smallScreenBreakpoint={640}
    />
  )
}

