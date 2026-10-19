---
name: example-shared-reusable-dto
description: Required code pattern for all shared-reusable-dto-generated outputs.
---

- **Strictly follow this pattern!**:

```typescript
import { t } from 'elysia'

export type lib_dto_payload = {
    user_id: number
}

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
  rows: t.Union([
    t.Number(),
    t.Null(),
  ]),
  pages: t.Union([
    t.Number(),
    t.Null(),
  ]),
  page: t.Number(),
  take: t.Number(),
  data: t.Any(),
}

export const lib_dto_<function_name>_<query | body | response> = {
  ...
}
```
