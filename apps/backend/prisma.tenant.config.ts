import {defineConfig} from "prisma/config"

export default defineConfig({
  schema: "prisma/tenant/schema.prisma",
  migrations:{path: "prisma/tenant/migrations"},
  datasource: {url: "file:./prisma/tenant/dev.db"}
})
