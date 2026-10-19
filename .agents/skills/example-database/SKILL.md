---
name: example-database
description: Required code pattern for all database client or tables schema generated outputs.
---

> [!IMPORTANT]
> **Database Schema Enum Rule**: Do NOT import or specify application enums (from `@lib/enum.lib`) in the database schema files. Use generic string or integer types for database columns, and let the DTO layer handle the enum validation. Coupling database schemas to application enums causes migration issues in SQLite when enums change.

1. **Client file (client.db.ts)**: Strictly follow this pattern!

```typescript
import type { Client } from '@libsql/client'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'

import { RedisClient } from 'bun'

import { createClient } from '@libsql/client'

import { drizzle } from 'drizzle-orm/libsql'

interface cached_connection {
  db: LibSQLDatabase<Record<string, unknown>>
  client: Client
}

const main_cache = new Map<string, cached_connection>()
const max_cached_tenants = Number(process.env.DB_MAX_CACHED_TENANTS) || 720
const tenant_cache = new Map<number, cached_connection>()

export function get_tenant_url(tenant_id: number): string {
  const db_name = `db-${process.env.APP_NAME}-${process.env.ENV}-tenant-${tenant_id}`
  return `https://${db_name}-${process.env.TURSO_ORG_NAME}.turso.io`
}

export async function db_client(options: { url?: string; token?: string; tenant_id?: number } = {}) {
  const { url, token, tenant_id } = options

  if (tenant_id != null) {
    if (tenant_cache.has(tenant_id)) {
      const cached = tenant_cache.get(tenant_id)!
      tenant_cache.delete(tenant_id)
      tenant_cache.set(tenant_id, cached)
      return cached.db
    }

    if (tenant_cache.size >= max_cached_tenants) {
      const oldest_key = tenant_cache.keys().next().value
      if (oldest_key !== undefined) {
        const oldest = tenant_cache.get(oldest_key)
        if (oldest) {
          oldest.client.close()
        }
        tenant_cache.delete(oldest_key)
      }
    }

    const resolved_url = get_tenant_url(tenant_id)
    const resolved_token = token || process.env.TURSO_GROUP_TOKEN!
    const client = createClient({ url: resolved_url, authToken: resolved_token })
    const db = drizzle(client) as LibSQLDatabase<Record<string, unknown>>
    tenant_cache.set(tenant_id, { db, client })
    return db
  }

  const resolved_url = url || process.env.TURSO_DB_MAIN_URL!
  const resolved_token = token || process.env.TURSO_DB_MAIN_TOKEN!
  const main_key = `${resolved_url}:${resolved_token}`

  const cached = main_cache.get(main_key)
  if (cached) return cached.db

  const client = createClient({ url: resolved_url, authToken: resolved_token })
  const db = drizzle(client) as LibSQLDatabase<Record<string, unknown>>
  main_cache.set(main_key, { db, client })
  return db
}

export const db_redis_auth = new RedisClient(process.env.REDIS_DB_AUTH_URL!)
export const db_redis_tenant_access = new RedisClient(process.env.REDIS_DB_TENANT_ACCESS_URL!)
export const db_redis_migration_lock = new RedisClient(process.env.REDIS_DB_MIGRATION_LOCK_URL!)
export const db_redis_rate_limiting = new RedisClient(process.env.REDIS_DB_RATE_LIMITING_URL!)
```

2. **Drizzle Config (drizzle.config.ts)**: Strictly follow this pattern!

```typescript
/// <reference types="bun-types" />
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/main.db.schema.ts',
  out: './drizzle',
  dialect: 'turso',
  dbCredentials: {
    url: process.env.TURSO_DB_MAIN_URL!,
    authToken: process.env.TURSO_DB_MAIN_TOKEN!,
  },
})
```

3. **Main Database Schema (main.db.schema.ts)**: Strictly follow this pattern!

```typescript
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import { enum_otp_action } from '@lib/enum.lib'

export const table_user = sqliteTable(
  "user",
  {
    user_id: integer("user_id").primaryKey({ autoIncrement: true }),
    user_phone: text("user_phone", { length: 18 }).notNull(),
    user_first_name: text("user_first_name", { length: 32 }).notNull(),
    user_last_name: text("user_last_name", { length: 32 }).notNull(),
    user_image: text("user_image", { length: 32 }),
    created_at: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    deleted_at: text("deleted_at"),
  },
  (table) => [
    index("user_phone_idx").on(table.user_phone),
    index("user_first_name_idx").on(table.user_first_name),
    index("user_last_name_idx").on(table.user_last_name),
    index("user_deleted_at_idx").on(table.deleted_at),
  ]
)

export const table_file = sqliteTable(
  "file",
  {
    file_id: text("file_id", { length: 64 }).primaryKey(),
    file_name: text("file_name", { length: 127 }),
    user_id: integer("user_id").notNull(),
    created_at: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    deleted_at: text("deleted_at"),
  },
  (table) => [
    index("file_name_idx").on(table.file_name),
    index("file_deleted_at_idx").on(table.deleted_at),
  ]
)

export const table_<table_name> = sqliteTable(
  '<table_name>',
  {
    <table_name>_<column_name>: <type>('<table_name>_<column_name>').<props>,
    //other columns...
    created_at: text('created_at').notNull().default(new Date().toISOString()),
    deleted_at: text('deleted_at'),
  },
  (table) => [
    index('<table_name>_<column_name>_idx').on(table.<table_name>_<column_name>),
    //other indexes...
  ]
)
```
