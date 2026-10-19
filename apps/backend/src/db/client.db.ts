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
