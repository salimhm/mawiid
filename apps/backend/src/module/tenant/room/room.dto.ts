import { t } from 'elysia'
import { lib_dto_find_response } from '@lib/dto.lib'
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

export const dto_schema_room_member = t.Object({
  room_member_id: t.Integer(),
  room_id: t.Integer(),
  user_id: t.Integer(),
  room_member_role: t.String(),
  room_member_status: t.String(),
  room_member_banned_at: t.Nullable(t.Date()),
  created_at: t.Date(),
  deleted_at: t.Nullable(t.Date()),
})

export const dto_room = {
  join: {
    detail: {
      tags: ['Room'],
      summary: 'Join a room',
      description: 'Joins an open or live room using an existing invited, waiting, or active membership. Banned, deleted, and declined memberships are refused. Only the host can join a locked room. The lobby puts guests into waiting; hosts and moderators bypass it. Active memberships count toward capacity; repeated joins preserve active status. Returns the membership only; LiveKit tokens and media connection are not implemented yet.',
      security: lib_openapi_security,
    },
    body: t.Object({
      vault_id: t.Integer({ minimum: 1, description: 'Vault containing the room.' }),
      room_uid: t.String({ format: 'uuid', description: 'UUID returned by creation or finding.' }),
    }, {
      examples: [{ vault_id: 1, room_uid: '00000000-0000-4000-8000-000000000001' }],
    }),
    response: t.Object({
      data: dto_schema_room_member,
    }),
  },
  find: {
    detail: {
      tags: ['Room'],
      summary: 'Find my rooms',
      description: 'Lists rooms in the selected vault where the caller has an invited, waiting, or active membership. Deleted rooms and deleted, banned, or declined memberships are excluded. Results are ordered newest first. Creation permission is not required.',
      security: lib_openapi_security,
    },
    query: t.Object({
      vault_id: t.Numeric({ minimum: 1, multipleOf: 1, description: 'Vault whose rooms to search.' }),
      room_uid: t.Optional(t.String({ format: 'uuid', description: 'Filter by one room UUID.' })),
      page: t.Optional(t.Numeric({ minimum: 1, maximum: 1000000, multipleOf: 1, default: 1 })),
      take: t.Optional(t.Numeric({ minimum: 1, maximum: 100, multipleOf: 1, default: 20 })),
    }),
    response: t.Object({
      ...lib_dto_find_response,
      data: t.Array(dto_schema_room),
    }),
  },
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
  update: {
    detail: {
      tags: ['Room'],
      summary: 'Rename a room',
      description: 'Changes only the room title. Requires an invited, waiting, or active host or moderator membership in the selected vault. Deleted rooms and deleted, banned, or declined memberships are refused. Creation permission is not required.',
      security: lib_openapi_security,
    },
    body: t.Object({
      vault_id: t.Integer({ minimum: 1, description: 'Vault containing the room.' }),
      room_uid: t.String({ format: 'uuid', description: 'UUID returned when the room was created or found.' }),
      room_title: t.String({ minLength: 1, maxLength: 200, pattern: '\\S', description: 'New title, trimmed before saving.' }),
    }),
    response: t.Object({
      data: dto_schema_room,
    }),
  },
  delete: {
    detail: {
      tags: ['Room'],
      summary: 'Delete a room',
      description: 'Soft-deletes a scheduled or closed room. Requires an eligible host membership; moderators cannot delete. Scheduled rooms are canceled. Open or live rooms return 409. The room is hidden from finding and renaming. Membership history is retained. Main routing cleanup is best effort; failure is logged without undoing tenant deletion.',
      security: lib_openapi_security,
    },
    body: t.Object({
      vault_id: t.Integer({ minimum: 1, description: 'Vault containing the room.' }),
      room_uid: t.String({ format: 'uuid', description: 'UUID of a scheduled or closed room.' }),
    }),
    response: t.Object({
      data: dto_schema_room,
    }),
  },
}
