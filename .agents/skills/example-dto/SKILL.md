---
name: example-dto
description: Required code pattern for all dto-generated outputs.
---

- **Strictly follow this pattern!**:

```typescript
import { t } from 'elysia'
import { lib_dto_find_query, lib_dto_find_response, /* the other reusable dto's: lib_dto_<query|body|response>_<function_name> */ } from '@lib/dto.lib'

export const enum_<module_name>_columns = [
  'column_1',
  'column_2',
  'created_at',
] as const

export const enum_<module_name>_order_by = [...enum_<module_name>_columns, ...enum_<module_name>_columns.map((c) => `-${c}`)] as const

export const dto_schema_<module_name> = t.Object({
  // the exact fields...
})

export const dto_<module_name> = {
  find: {
    query: t.Object({
      ...lib_dto_find_query,
      columns: t.Array(t.UnionEnum(enum_<module_name>_columns)),
      order_by: t.Optional(t.Array(t.UnionEnum(enum_<module_name>_order_by))),
      group_by: t.Optional(t.Array(t.UnionEnum(enum_<module_name>_columns))),
      // filter values as arrays if [] operator is used in service
      <column_1>: t.Optional(t.Array(t.String())),
    }),
    response: t.Object({
      ...lib_dto_find_response,
      data: t.Array(t.Partial(dto_schema_<module_name>)),
    }),
  },
  create: {
    body: t.Object({
      // the other values...
    }),
    response: t.Object({
      data: dto_schema_<module_name>,
    }),
  },
  update: {
    body: t.Object({
      // the other values...
    }),
    response: t.Object({
      data: dto_schema_<module_name>,
    }),
  },
  delete: {
    body: t.Object({
      // the other values...
    }),
    response: t.Object({
      data: dto_schema_<module_name>,
    }),
  },
  <other_function_name>: {
    <query | body>: t.Object({
      // the other values...
    }),
    response: t.Object({
      data: dto_schema_<module_name>,
    }),
  },
}
```
