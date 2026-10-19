---
name: example-service
description: Required code pattern for all service-generated outputs.
---

- **Strictly follow this pattern!**:

```typescript
import { Static } from 'elysia'
import { eq, sql, /* others... */ } from 'drizzle-orm'
import { dto_<module_name> } from './<module_name>.dto'
import { table_<module_name> } from '@db/main.db.schema'
import { lib_dto_payload, /* the other reusable dto's */ } from '@lib/dto.lib'

export const service_<module_name> = {
  async <function_name>(
    <query | body>: Static<typeof dto_<module_name>.<function_name>.<query | body>>,
    payload: lib_dto_payload, // only if needed!
  ): Promise<Static<typeof dto_<module_name>.<function_name>.response>> {
    // your code...
  },
}
```
