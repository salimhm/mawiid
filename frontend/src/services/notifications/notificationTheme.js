const STATUS_COLORS = {
  success: '#22c55e',
  error: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
  loading: '#a855f7',
  none: '#9ca3af',
}

const color_for_status = (status) => STATUS_COLORS[status] || STATUS_COLORS.none

export const mawiidTheme = {
  container: (position, singleContainer) => ({
    position: 'fixed',
    zIndex: 999999,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    pointerEvents: 'none',
    top: '20px',
    right: '20px',
    maxWidth: 'calc(100vw - 32px)',
    width: '380px',
  }),

  notification: (notification) => ({
    display: 'flex',
    position: 'relative',
    width: '100%',
    boxSizing: 'border-box',
    borderRadius: '16px',
    border: '1px solid rgba(255, 255, 255, 0.14)',
    borderLeft: `4px solid ${color_for_status(notification.status)}`,
    backgroundColor: 'rgba(18, 18, 22, 0.94)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    boxShadow: '0 16px 36px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.35)',
    color: '#ffffff',
    marginBottom: '12px',
    overflow: 'hidden',
    pointerEvents: 'auto',
    cursor: notification.dismissible && !notification.showDismissButton ? 'pointer' : 'default',
  }),

  notificationIcon: (notification) => ({
    display: notification.image ? 'none' : 'flex',
    width: '20px',
    height: '20px',
    boxSizing: 'border-box',
    margin: '14px 0 14px 16px',
    alignSelf: 'flex-start',
    flexShrink: 0,
    color: color_for_status(notification.status),
  }),

  notificationDismissIcon: () => ({
    width: '14px',
    height: '14px',
    margin: '16px 14px 16px 6px',
    cursor: 'pointer',
    color: 'rgba(255, 255, 255, 0.5)',
    flexShrink: 0,
    transition: 'color 0.15s ease',
  }),

  notificationMeta: () => ({
    boxSizing: 'border-box',
    width: '100%',
    padding: '12px 14px 12px 12px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    minWidth: 0,
  }),

  notificationTitle: (notification) => ({
    margin: notification.message ? '0 0 4px 0' : 0,
    fontSize: '14px',
    fontWeight: 650,
    fontFamily: 'Montserrat, sans-serif',
    color: '#ffffff',
    lineHeight: 1.35,
    wordBreak: 'break-word',
  }),

  notificationMessage: () => ({
    margin: 0,
    fontSize: '13px',
    fontFamily: 'Inter, sans-serif',
    color: 'rgba(255, 255, 255, 0.78)',
    lineHeight: 1.45,
    wordBreak: 'break-word',
  }),

  notificationImageContainer: () => ({
    boxSizing: 'border-box',
    padding: '12px 0 12px 14px',
    flexShrink: 0,
  }),

  notificationImage: () => ({
    display: 'inline-flex',
    borderRadius: '999px',
    width: '36px',
    height: '36px',
    backgroundSize: 'cover',
  }),

  notificationButtons: () => ({
    display: 'flex',
    flexDirection: 'column',
    borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
    flexShrink: 0,
  }),

  notificationButton: (notification, position, state) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    minHeight: '38px',
    boxSizing: 'border-box',
    padding: '0 14px',
    background: state.isHovered ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
    border: 'none',
    borderTop: position > 0 ? '1px solid rgba(255, 255, 255, 0.1)' : 'none',
    outline: 'none',
    color: state.isHovered ? '#ffffff' : '#3b82f6',
    cursor: 'pointer',
    transition: 'background 0.15s ease, color 0.15s ease',
  }),

  notificationButtonText: () => ({
    fontFamily: 'Montserrat, sans-serif',
    fontSize: '12px',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),
}

