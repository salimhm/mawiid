---
name: example-tool
description: Required code pattern for all tool-generated outputs.
---

- **Strictly follow this pattern!**:
- **Folder Structure**:
  - `src/ai/tool/<module-name>/<module-name>.tool.ts`
  - `src/ai/tool/<module-name>/<module-name>.dto.tool.ts`

```typescript
// src/ai/tool/<module-name>/<module-name>.dto.tool.ts
import { z } from "zod"
export const dto_tool_<module_name> = {
    <function_name>: z.object({
        <key>: z.<string | number | ...>().describe(""),
    }),
}

// src/ai/tool/<module-name>/<module-name>.tool.ts
import { createTool, createToolkit } from "@voltagent/core"
import { service_<module_name> } from "@module/organization/<module-name>/<module-name>.service"
import { lib_tool_check_context, lib_tool_check_contact_name } from "@tool/utils.tool"
import { dto_tool_<module_name> } from "./<module-name>.dto.tool"

export const tool_<module_name>_<function_name> = createTool({
    name: "tool_<module_name>_<function_name>",
    description: "...",
    parameters: dto_tool_<module_name>.<function_name>,
    execute: async ({ <key> }, options) => {
        const context = lib_tool_check_context(options)
        if (!context.success) return context

        const { organization_id, contact_phone, payload } = context

        // Optional: if contact name is required
        const contact_check = await lib_tool_check_contact_name(organization_id, contact_phone)
        if (!contact_check.success) return contact_check

        return await service_<module_name>.<action>(
          {
            ...
            organization_id,
          },
          payload
        )
    },
})

// if we have many tools of the same module
export const toolkit_<module_name> = createToolkit({
    name: "toolkit_<module_name>",
    description: "...",
    tools: [tool_<module_name>_<function_name>],
})
```
