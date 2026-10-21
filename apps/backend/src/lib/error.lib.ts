export const lib_error = {
  bad_request: { status: 400, code: 'bad-request' },
  invalid_token: { status: 401, code: 'invalid-token' },
  unauthorized: { status: 401, code: 'unauthorized' },
  forbidden: { status: 403, code: 'forbidden' },
  room_waiting: { status: 403, code: 'room-waiting' },
  not_found: { status: 404, code: 'not-found' },
  room_not_found: { status: 404, code: 'room-not-found' },
  room_member_not_found: { status: 404, code: 'room-member-not-found' },
  participant_not_found: { status: 404, code: 'participant-not-found' },
  track_not_found: { status: 404, code: 'track-not-found' },
  room_full: { status: 409, code: 'room-full' },
  room_closed: { status: 410, code: 'room-closed' },
  unprocessable_entity: { status: 422, code: 'unprocessable-entity' },
  room_locked: { status: 423, code: 'room-locked' },
  too_many_requests: { status: 429, code: 'too-many-requests' },
  internal_server_error: { status: 500, code: 'internal-server-error' },
  service_unavailable: { status: 503, code: 'service-unavailable' },
  livekit_unavailable: { status: 503, code: 'livekit-unavailable' },
}

export type lib_error_value = (typeof lib_error)[keyof typeof lib_error]
