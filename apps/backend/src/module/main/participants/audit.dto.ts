import { t } from 'elysia'
import { lib_dto_find_response } from '@lib/dto.lib'

export const dto_schema_audit = t.Object({
  audit_id: t.Number(),
  room_id: t.Nullable(t.Number()),
  user_id: t.Nullable(t.Number()),
  audit_action: t.String(),
  audit_target: t.String(),
  audit_metadata: t.Any(),
  created_at: t.Date(),
})

export const dto_audit = {
  find: {
    query: t.Object({
      room_uid: t.String({ format: 'uuid' }),
      page: t.Optional(t.Numeric({ minimum: 1 })),
      take: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
      audit_action: t.Optional(t.Array(t.String())),
    }),
    response: t.Object({
      ...lib_dto_find_response,
      data: t.Array(dto_schema_audit),
    }),
  },
}
