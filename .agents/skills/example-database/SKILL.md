---
name: example-database
description: Required code pattern for all database client or tables schema generated outputs.
---

> [!IMPORTANT]
> **Database Schema Enum Rule**: Do NOT use Prisma `enum` blocks or application enums (from `@lib/enum.lib`) in the schema files. Use `String` or `Int` columns and let the DTO layer handle the enum validation. Changing an enum in SQLite forces a table rebuild in the next migration.

> [!IMPORTANT]
> **Two schemas**: `prisma/main/schema.prisma` holds the tables shared by everyone (one main database). `prisma/tenant/schema.prisma` holds the tables every tenant database gets. Query them only from services, through `database.main_db` and `database.vault_db(<tenant_url>)`.

1. **Client file (src/db/client.db.ts)**: Strictly follow this pattern!

```typescript
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { PrismaClient as MainClient } from '@db/generated/main/client.ts'
import { PrismaClient as TenantClient } from '@db/generated/tenant/client.ts'

export function create_database_client() {
  const main_db = new MainClient({
    adapter: new PrismaLibSql({
      url: process.env.TURSODB_URL!,
      authToken: process.env.TURSODB_TOKEN!,
    }),
  })
  const max_cached_tenants = Number(process.env.DB_MAX_CACHED_TENANTS) || 100
  const vault_cache = new Map<string, TenantClient>()

  function vault_db(url: string) {
    let db = vault_cache.get(url)
    if (db) {
      vault_cache.delete(url)
    } else {
      db = new TenantClient({
        adapter: new PrismaLibSql({ url, authToken: process.env.TURSODB_GROUP_TOKEN! }),
      })
    }
    vault_cache.set(url, db)
    if (vault_cache.size > max_cached_tenants) {
      const [old_url, old_db] = vault_cache.entries().next().value!
      vault_cache.delete(old_url)
      void old_db.$disconnect().catch(() => {
        console.error('Could not close an evicted tenant database client')
      })
    }
    return db
  }

  async function close() {
    const client = [main_db, ...vault_cache.values()]
    vault_cache.clear()
    await Promise.all(client.map((db) => db.$disconnect()))
  }

  return { main_db, vault_db, close }
}
```

2. **Prisma config (prisma.<main | tenant>.config.ts)**: Strictly follow this pattern!

```typescript
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/<main | tenant>/schema.prisma',
  migrations: { path: 'prisma/<main | tenant>/migrations' },
  datasource: { url: 'file:./prisma/<main | tenant>/dev.db' },
})
```

The `datasource.url` is a local scratch file on purpose: Prisma's CLI cannot connect to Turso. `bun run db:deploy:main` applies the generated SQL to Turso through `apply_migration` in `@db/utils.db`.

3. **Schema (prisma/<main | tenant>/schema.prisma)**: Strictly follow this pattern!

```prisma
generator client {
  provider        = "prisma-client"
  output          = "../../src/db/generated/<main | tenant>"
  previewFeatures = ["partialIndexes"]
}

datasource db {
  provider = "sqlite"
}

model User {
  user_id         Int       @id @default(autoincrement())
  user_phone      String
  user_first_name String
  user_last_name  String
  user_image      String?
  created_at      DateTime  @default(now())
  deleted_at      DateTime?

  @@unique([user_phone], map: "user_phone_idx", where: { deleted_at: null })
  @@index([user_first_name], map: "user_first_name_idx")
  @@index([user_last_name], map: "user_last_name_idx")
  @@index([deleted_at], map: "user_deleted_at_idx")
  @@map("user")
}

model <TableName> {
  <table_name>_id            Int              @id @default(autoincrement())
  <table_name>_<column_name> <Type>
  <other_table_name>_id      Int
  created_at                 DateTime         @default(now())
  deleted_at                 DateTime?
  <other_table_name>         <OtherTableName> @relation(fields: [<other_table_name>_id], references: [<other_table_name>_id])

  @@index([<table_name>_<column_name>], map: "<table_name>_<column_name>_idx")
  @@index([deleted_at], map: "<table_name>_deleted_at_idx")
  @@map("<table_name>")
}
```

- Model names are PascalCase; `@@map("<table_name>")` gives the singular, snake_case table name.
- Field names are snake_case and are the column names; never put `@map` on a field.
- Primary key: `<table_name>_id Int @id @default(autoincrement())`. Own columns are prefixed `<table_name>_`; foreign keys keep the referenced key's name (`user_id`).
- Every table has `created_at` and `deleted_at`. Deletes are soft: set `deleted_at`, and index it.
- A value that must be unique among live rows uses a partial unique index: `@@unique([...], where: { deleted_at: null })`.
- No lengths (SQLite ignores them). JSON columns use `Json @default("[]")`. Never use `@default(dbgenerated(...))`: it makes every `migrate dev` rebuild the table.

4. **Migrations**: run from `apps/backend` in a Windows terminal.

```bash
bun run db:migrate:<main | tenant> --name <change>
bun run db:generate
bun run db:deploy:main
```
