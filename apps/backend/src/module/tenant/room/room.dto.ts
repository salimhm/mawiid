import { t } from 'elysia'
import { lib_openapi_security } from '@lib/openapi.lib'

export const dto_schema_room = t.Object({
  room_id: t.Integer(),
  room_uid: t.String({ format: 'uuid' }),
  room_title: t.String(),
  room_type: t.String(),
  room_status: t.String(),
  room_visibility: t.String(),
  room_max_participants: t.Integer(),
  room_locked: t.Boolean(),
  room_lobby_enabled: t.Boolean(),
  room_translation_enabled: t.Boolean(),
  room_recording_allowed: t.Boolean(),
  room_encrypted: t.Boolean(),
  room_scheduled_at: t.Nullable(t.Date()),
  room_started_at: t.Nullable(t.Date()),
  room_closed_at: t.Nullable(t.Date()),
  room_close_reason: t.Nullable(t.String()),
  user_id: t.Integer(),
  created_at: t.Date(),
  deleted_at: t.Nullable(t.Date()),
})

export const dto_room = {
  create: {
    detail: {
      tags: ['Room'],
      summary: 'Create a group room',
      description: 'Creates an open, private room for up to 12 users in an existing vault. Requires room.create access. The authenticated creator becomes the host; user_ids become invited members. Uses the existing development x-user-id header. This endpoint does not connect to LiveKit.',
      security: lib_openapi_security,
    },
    body: t.Object({
      vault_id: t.Integer({ minimum: 1, description: 'Existing vault where the caller has room.create access.' }),
      room_title: t.String({ minLength: 1, maxLength: 200, pattern: '\\S', description: 'Room title, trimmed before saving.' }),
      user_ids: t.Optional(t.Array(t.Integer({ minimum: 1 }), { maxItems: 11, uniqueItems: true, description: 'Initial invitees. The creator is included automatically.' })),
    }, {
      examples: [{ vault_id: 1, room_title: 'Team meeting', user_ids: [2, 3] }],
    }),
    response: t.Object({
      data: dto_schema_room,
    }),
  },
}
