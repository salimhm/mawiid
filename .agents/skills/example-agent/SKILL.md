---
name: example-agent
description: Required code pattern for all ai agents, ai-agent-prompt, and ai-agent-schema generated outputs.
---

1. **Agent**: Strictly follow this pattern!

```typescript
import { Agent } from "@voltagent/core"
import { google } from "@ai-sdk/google"
import { Output } from "ai"
import { tool_<module_name> } from "@tool/<module-name>.tool"
import { prompt_agent_<agent_name> } from "@agent/<agent-name>.prompt.agent"
import { schema_agent_<agent_name> } from "@agent/<agent-name>.schema.agent"

export const $agent_<agent_name> = new Agent({
  name: "Chat Assistant",
  instructions: `You are a friendly and helpful assistant.`,
  model: google(process.env.DEFAULT_AI_MODEL_NAME || "gemini-3-flash-preview"),
  tools: [tool_<module_name>, /* the other tools & toolkits... */],
});

export const agent_<agent_name> = async (message: string): Promise<{ success: boolean; data: any }> => {
  try {
    const result = await $agent_<agent_name>.generateText(message, {
      output: Output.object({ schema: schema_agent_<agent_name> }),
    })
    return { success: true, data: result.text }
  } catch (error) {
    return { success: false, data: error }
  }
}
```

2. **Schema**: Strictly follow this pattern!

```typescript
import { z } from "zod"

export const schema_agent_<agent_name> = z.object({
    message: z.string().describe("The assistant's text response to the user"),
})

export type type_schema_agent_<agent_name> = z.infer<typeof schema_agent_<agent_name>>
```
