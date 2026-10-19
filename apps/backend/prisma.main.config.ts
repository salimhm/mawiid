import {defineConfig} from "prisma/config"

export default defineConfig({
  schema: "prisma/main/schema.prisma",
  migrations:{path: "prisma/main/migrations"},
  datasource: {url: "file:./prisma/main/dev.db"}
})
