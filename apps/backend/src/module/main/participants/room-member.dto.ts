import { t } from 'elysia'
import { enum_room_member_decision, enum_room_member_role } from '@lib/enum.lib'
import { lib_dto_enum, lib_dto_room_target_body } from '@lib/dto.lib'

export const dto_schema_room_member = t.Object({
  room_member_id: t.Number(),
  room_id: t.Number(),
  user_id: t.Number(),
  room_member_role: t.String(),
  room_member_status: t.String(),
  room_member_banned_at: t.Nullable(t.Date()),
  created_at: t.Date(),
  deleted_at: t.Nullable(t.Date()),
})

export const dto_room_member = {
  update: {
    body: t.Object({
      ...lib_dto_room_target_body,
      room_member_role: t.Optional(lib_dto_enum(enum_room_member_role)),
      room_member_status: t.Optional(lib_dto_enum(enum_room_member_decision)),
    }),
    response: t.Object({
      data: dto_schema_room_member,
    }),
  },
  delete: {
    body: t.Object({
      ...lib_dto_room_target_body,
      ban: t.Optional(t.Boolean()),
    }),
    response: t.Object({
      data: dto_schema_room_member,
    }),
  },
}
