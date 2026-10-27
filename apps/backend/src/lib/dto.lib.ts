import { t } from 'elysia'

export type lib_dto_payload = {
  user_id: number
}

export const lib_dto_error_response = t.Object(
  {
    code: t.String({ description: 'Error code from lib_error, for example `invalid-token`' }),
  },
  { title: 'Error' },
)

export const lib_dto_find_query = {
  page: t.Optional(t.Numeric()),
  take: t.Optional(t.Numeric()),
  count: t.Optional(t.UnionEnum(['true', 'false'])),
  order_by: t.Optional(t.Array(t.String())),
  group_by: t.Optional(t.Array(t.String())),
  combination_type: t.Optional(t.UnionEnum(['AND', 'OR'])),
  created_at: t.Optional(t.Array(t.String())),
}

export const lib_dto_find_response = {
  rows: t.Union([t.Number(), t.Null()]),
  pages: t.Union([t.Number(), t.Null()]),
  page: t.Number(),
  take: t.Number(),
  data: t.Any(),
}

export const lib_dto_room_body = {
  room_uid: t.String({ format: 'uuid' }),
}

export const lib_dto_room_target_body = {
  ...lib_dto_room_body,
  user_id: t.Integer({ minimum: 1 }),
}

export function lib_dto_enum<const values extends readonly [string, ...string[]]>(values: values) {
  const schema = t.UnionEnum(values)
  delete (schema as { default?: unknown }).default
  return schema
}
