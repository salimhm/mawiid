export const HTTP_ERROR_MESSAGES = {
  400: 'The request could not be processed. Please check your input.',
  401: 'Your session has expired. Please sign in again.',
  403: 'You do not have permission to perform this action.',
  404: 'The requested resource was not found.',
  409: 'A conflict occurred. The resource may already exist or has changed.',
  422: 'Some of the information provided is invalid. Please review and try again.',
  429: 'Too many requests. Please slow down and try again shortly.',
  500: 'An unexpected server error occurred. Please try again later.',
  502: 'The server gateway is currently unavailable. Please try again.',
  503: 'The service is temporarily unavailable. Please try again later.',
  504: 'The server took too long to respond. Please check your connection.',
}

export const DOMAIN_ERROR_MESSAGES = {
  unauthorized: 'You are not signed in. Please sign in to continue.',
  'invalid-token': 'Your session has expired. Please sign in again.',
  'invalid-credentials': 'Incorrect username, email or password.',
  'email-not-verified': 'Please verify your email before signing in.',
  'user-email-exist': 'An account already uses this email. Sign in instead.',
  'user-username-exist': 'This username is taken. Choose another one.',
  'invalid-otp-code': 'That code is incorrect. Check it and try again.',
  'code-expired': 'This code has expired. Request a new one.',
  'user-not-found': 'No account was found with those details.',
  'user-phone-exist': 'An account already uses this phone number. Sign in instead.',
  'too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
  'service-unavailable': 'The authentication service is temporarily unavailable.',
  'email-unavailable': 'Verification emails cannot be sent right now. Try again later.',
  forbidden: 'You do not have permission to perform this action.',
  'participant-not-found': 'That participant is no longer in this meeting.',
  'track-not-found': 'That media track is no longer available.',
  'room-member-not-found': 'That person is no longer a member of this room.',
  'bad-request': 'That action cannot be applied right now.',
  'room-not-found': 'This meeting does not exist. Check the code and try again.',
  'vault-unavailable': 'Your workspace could not be set up right now. Try again shortly.',
  'room-closed': 'This meeting has been closed.',
  'room-locked': 'This meeting is locked by the host.',
  'room-not-open': 'This meeting is not open yet.',
  'room-waiting': 'Waiting for the host to let you in…',
  'unprocessable-entity': 'Some of the information is invalid. Please check and try again.',
  'livekit-unavailable': 'The media server is unavailable. Try again shortly.',
  'backend-unavailable': 'Cannot reach the Mawiid server. Check your connection.',
  'network-error': 'Network connection lost. Please check your internet.',
  timeout: 'The operation timed out. Please try again.',
  aborted: 'The request was canceled.',
}

export const MEDIA_ERROR_MESSAGES = {
  NotAllowedError: 'Permission to access microphone or camera was denied. Check your browser permissions.',
  PermissionDeniedError: 'Permission to access microphone or camera was denied.',
  NotFoundError: 'No microphone or camera device was found on this system.',
  DevicesNotFoundError: 'No media input devices were detected.',
  NotReadableError: 'Your camera or microphone is in use by another application.',
  TrackStartError: 'Could not start video or audio source. Device may be in use.',
  OverconstrainedError: 'Requested media resolution or settings are not supported by your hardware.',
  TypeError: 'Invalid media device configuration.',
}

export const NOTIFICATION_TITLES = {
  success: 'Success',
  error: 'Error',
  warning: 'Warning',
  info: 'Information',
  loading: 'Please wait',
  none: '',
}

export const resolveErrorMessage = (error, fallback = 'Something went wrong. Please try again.') => {
  if (!error)
    return fallback

  if (typeof error === 'string') {
    const from_domain = DOMAIN_ERROR_MESSAGES[error]
    if (from_domain) return from_domain
    return error
  }

  const code = error.code || error.error_code
  if (code && DOMAIN_ERROR_MESSAGES[code])
    return DOMAIN_ERROR_MESSAGES[code]

  const error_name = error.name
  if (error_name && MEDIA_ERROR_MESSAGES[error_name])
    return MEDIA_ERROR_MESSAGES[error_name]

  const status = Number(error.status)
  if (status && HTTP_ERROR_MESSAGES[status])
    return HTTP_ERROR_MESSAGES[status]

  if (error.message && typeof error.message === 'string' && error.message !== '[object Object]')
    return error.message

  return fallback
}

