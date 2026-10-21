import { t } from 'elysia'
import { enum_participant_track_source } from '@lib/enum.lib'
import { lib_dto_enum, lib_dto_room_body, lib_dto_room_target_body } from '@lib/dto.lib'

export const dto_schema_participant = t.Object({
  room_uid: t.String(),
  user_id: t.Number(),
  room_member_role: t.String(),
  participant_attributes: t.Record(t.String(), t.String()),
})

export const dto_participant = {
  update: {
    body: t.Object({
      ...lib_dto_room_body,
      participant_hand_raised: t.Optional(t.Boolean()),
      participant_language: t.Optional(t.String({ pattern: '^[a-z]{2,3}(-[A-Z]{2})?$' })),
    }),
    response: t.Object({
      data: dto_schema_participant,
    }),
  },
  delete: {
    body: t.Object({
      ...lib_dto_room_target_body,
      block_minutes: t.Optional(t.Integer({ minimum: 1, maximum: 10080 })),
    }),
    response: t.Object({
      data: dto_schema_participant,
    }),
  },
  mute: {
    body: t.Object({
      ...lib_dto_room_target_body,
      track_source: lib_dto_enum(enum_participant_track_source),
      muted: t.Boolean(),
    }),
    response: t.Object({
      data: dto_schema_participant,
    }),
  },
  promote: {
    body: t.Object({
      ...lib_dto_room_target_body,
    }),
    response: t.Object({
      data: dto_schema_participant,
    }),
  },
  demote: {
    body: t.Object({
      ...lib_dto_room_target_body,
    }),
    response: t.Object({
      data: dto_schema_participant,
    }),
  },
  webhook: {
    body: t.String({ maxLength: 1048576 }),
    response: t.Object({
      data: t.Object({
        duplicate: t.Boolean(),
        removed: t.Boolean(),
      }),
    }),
  },
}
