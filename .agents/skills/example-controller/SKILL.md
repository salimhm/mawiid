---
name: example-controller
description: Required code pattern for all controller-generated outputs.
---

- **Strictly follow this pattern!**:

```typescript
import { Elysia } from 'elysia'

import { lib_jwt } from '@lib/jwt.lib'
import { dto_<module_name> } from './<module_name>.dto'
import { service_<module_name> } from './<module_name>.service'

export const controller_<module_name> = new Elysia({ prefix: '/<module_name>' })

  .use(lib_jwt)

  .get(
    '/',
    async (context) => {
      const { payload, query, /* others... */ } = context

      return await service_<module_name>.find(query, payload)
    },
    dto_<module_name>.find
  )

  .<method_name>(
    '/',
    async (context) => {
      const { payload, <query | body>, /* others... */ } = context

      return await service_<module_name>.<function_name>(<query | body>, payload)
    },
    dto_<module_name>.<function_name>
  )
```
