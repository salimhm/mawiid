export const lib_error = {
  bad_request: { status: 400, code: 'bad-request' },
  invalid_token: { status: 401, code: 'invalid-token' },
  unauthorized: { status: 401, code: 'unauthorized' },
  forbidden: { status: 403, code: 'forbidden' },
  not_found: { status: 404, code: 'not-found' },
  unprocessable_entity: { status: 422, code: 'unprocessable-entity' },
  too_many_requests: { status: 429, code: 'too-many-requests' },
  internal_server_error: { status: 500, code: 'internal-server-error' },
  service_unavailable: { status: 503, code: 'service-unavailable' },
  room_not_found: { status: 404, code: 'room-not-found' },
  room_waiting: { status: 403, code: 'room-waiting' },
  room_full: { status: 409, code: 'room-full' },
  room_closed: { status: 410, code: 'room-closed' },
  room_not_open: { status: 409, code: 'room-not-open' },
  room_not_deletable: { status: 409, code: 'room-not-deletable' },
  room_locked: { status: 423, code: 'room-locked' },
  livekit_unavailable: { status: 503, code: 'livekit-unavailable' },
} as const;

export type type_lib_error = (typeof lib_error)[keyof typeof lib_error];
