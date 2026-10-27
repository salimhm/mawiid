export const room_topic = {
  message: 'mawiid.message.v1',
  moderation: 'mawiid.moderation.v1',
  typing: 'mawiid.typing.v1',
  reaction: 'mawiid.reaction.v1',
} as const

export const room_attribute = {
  user_id: 'mawiid.user_id',
  role: 'mawiid.role',
  language: 'mawiid.language',
  hand_raised: 'mawiid.hand_raised',
} as const

export const room_socket_event = {
  knock: 'room.knock',
  admitted: 'room.admitted',
} as const

export const room_signal_limit = {
  typing_interval_ms: 3000,
  typing_expire_ms: 5000,
  reaction_interval_ms: 250,
  reaction_max_length: 16,
  payload_max_bytes: 1024,
} as const

export type type_room_socket_type = (typeof room_socket_event)[keyof typeof room_socket_event]

export type type_room_socket_envelope<data = unknown> = {
  type: string
  version: 1
  data: data
  sent_at: string
}

export type type_room_event_knock = {
  room_uid: string
  user_id: number
  user_name: string
}

export type type_room_event_admitted = {
  room_uid: string
}

export type type_room_event_typing = {
  type: 'typing'
  typing: boolean
}

export type type_room_event_reaction = {
  type: 'reaction'
  reaction_id: string
  reaction: string
}

export type type_room_event_moderation =
  | { type: 'participant.muted'; room_uid: string; track_source: string }
  | { type: 'participant.unmute_requested'; room_uid: string; track_source: string }
  | { type: 'participant.role_changed'; room_uid: string; room_member_role: string }

export type type_room_event_message = {
  type: 'message.created'
  room_uid: string
  message_id: number
  user_id: number
  recipient_user_id: number
  message_client_id: string
  message_text: string
  created_at: string
}
