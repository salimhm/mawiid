import { t } from 'elysia'
import { lib_dto_room_body } from '@lib/dto.lib'

export const dto_schema_room = t.Object({
  room_id: t.Number(),
  room_uid: t.String(),
  room_title: t.String(),
  room_type: t.String(),
  room_status: t.String(),
  room_visibility: t.String(),
  room_max_participants: t.Number(),
  room_locked: t.Boolean(),
  room_lobby_enabled: t.Boolean(),
  room_translation_enabled: t.Boolean(),
  room_recording_allowed: t.Boolean(),
  room_encrypted: t.Boolean(),
  room_scheduled_at: t.Nullable(t.Date()),
  room_started_at: t.Nullable(t.Date()),
  room_closed_at: t.Nullable(t.Date()),
  room_close_reason: t.Nullable(t.String()),
  user_id: t.Number(),
  created_at: t.Date(),
  deleted_at: t.Nullable(t.Date()),
})

export const dto_room = {
  update: {
    body: t.Object({
      ...lib_dto_room_body,
      room_locked: t.Optional(t.Boolean()),
      room_lobby_enabled: t.Optional(t.Boolean()),
    }),
    response: t.Object({
      data: dto_schema_room,
    }),
  },
  join: {
    body: t.Object({
      ...lib_dto_room_body,
    }),
    response: t.Object({
      data: t.Object({
        server_url: t.String(),
        participant_token: t.String(),
        room: dto_schema_room,
        room_member_role: t.String(),
      }),
    }),
  },
}
