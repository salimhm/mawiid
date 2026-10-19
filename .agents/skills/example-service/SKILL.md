---
name: example-service
description: Required code pattern for all service-generated outputs.
---

- **Strictly follow this pattern!**:

```typescript
import type { Static } from 'elysia'
import type { create_database_client } from '@db/client.db'
import type { lib_dto_payload } from '@lib/dto.lib'
import { dto_<module_name> } from './<module_name>.dto'

export const service_<module_name> = {
  async find(
    query: Static<typeof dto_<module_name>.find.query>,
    payload: lib_dto_payload, // only if needed!
    database: ReturnType<typeof create_database_client>,
  ): Promise<Static<typeof dto_<module_name>.find.response>> {
    const data = await database.main_db.<table_name>.findMany({
      where: { deleted_at: null },
    })
    // your code...
  },

  async delete(
    body: Static<typeof dto_<module_name>.delete.body>,
    payload: lib_dto_payload, // only if needed!
    database: ReturnType<typeof create_database_client>,
  ): Promise<Static<typeof dto_<module_name>.delete.response>> {
    const data = await database.main_db.<table_name>.update({
      where: { <table_name>_id: body.<table_name>_id },
      data: { deleted_at: new Date() },
    })
    return { data }
  },
}
```

- Main-database tables: `database.main_db.<table_name>`. Tenant tables: `database.vault_db(<tenant_url>).<table_name>`.
- Always filter `deleted_at: null`. `delete` never removes a row; it sets `deleted_at`.
- Import `Static`, `lib_dto_payload` and `create_database_client` with `import type`: `verbatimModuleSyntax` rejects plain imports of types.
