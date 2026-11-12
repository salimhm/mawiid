import { setUpNotifications, POSITIONS, STATUSES } from 'reapop'

export const NOTIFICATION_DURATIONS = {
  short: 3000,
  default: 4500,
  medium: 6000,
  long: 8000,
  persistent: 0,
}

export const NOTIFICATION_STATUS = STATUSES
export const NOTIFICATION_POSITION = POSITIONS

export const configureNotifications = () => {
  setUpNotifications({
    defaultProps: {
      position: NOTIFICATION_POSITION.bottomRight,
      dismissible: true,
      dismissAfter: NOTIFICATION_DURATIONS.default,
      showDismissButton: true,
      allowHTML: false,
    },
  })
}

