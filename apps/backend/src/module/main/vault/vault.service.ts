import { dirname, join } from 'node:path'
import type { create_database_client } from '@db/client.db'
import { apply_migration } from '@db/utils.db'
import { lib_error } from '@lib/error.lib'
import { log } from 'node:console'

const vault_owner_type = 'user'
const vault_owner_action = ['room.create']
const vault_migration_directory = join(import.meta.dir, '../../../../prisma/tenant/migrations')
const vault_turso_api = 'https://api.turso.tech/v1/organizations'
const vault_retry_delay_ms = 500
const vault_pending = new Map<number, Promise<vault_record>>()

type vault_database = ReturnType<typeof create_database_client>
type vault_location = { url: string; auth_token: string }
type vault_record = NonNullable<Awaited<ReturnType<vault_database['main_db']['vault']['findFirst']>>>

function vault_name(user_id: number) {
  return `${process.env.TURSODB_GROUP_NAME}-user-${user_id}`
}

function provision_local(user_id: number): vault_location {
  const main_path = process.env.TURSODB_URL!.slice('file:'.length)
  return { url: `file:${join(dirname(main_path), `vault-user-${user_id}.db`)}`, auth_token: 'local' }
}

async function turso(path: string, init?: RequestInit) {
  const token = process.env.TURSODB_API_TOKEN
  if (!token) {
    console.error('[vault] TURSODB_API_TOKEN is not set: vault databases cannot be created')
    throw lib_error.vault_unavailable
  }
  try {
    return await fetch(`${vault_turso_api}/${process.env.TURSODB_ORG}/databases${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    })
  } catch (error) {
    console.error('[vault] Turso API unreachable', error)
    throw lib_error.vault_unavailable
  }
}

async function provision_turso(user_id: number): Promise<vault_location> {
  const name = vault_name(user_id)
  let res = await turso('', { method: 'POST', body: JSON.stringify({ name, group: process.env.TURSODB_GROUP_NAME }) })
  if (res.status === 409) res = await turso(`/${name}`)
  if (!res.ok) {
    console.error('[vault] Turso API returned', res.status, await res.text().catch(() => ''))
    throw lib_error.vault_unavailable
  }
  const body = (await res.json()) as { database?: { Hostname?: string } }
  if (!body.database?.Hostname) throw lib_error.vault_unavailable
  return { url: `libsql://${body.database.Hostname}`, auth_token: process.env.TURSODB_GROUP_TOKEN! }
}

export const service_vault = {
  async find(user_id: number, database: vault_database) {
    return await database.main_db.vault.findFirst({
      where: { vault_owner_type, vault_owner_id: user_id, deleted_at: null },
    })
  },

  async create(user_id: number, database: vault_database) {
    const existing = await service_vault.find(user_id, database)
    if (existing) return existing
    const pending = vault_pending.get(user_id)
    if (pending) return await pending
    const provision = service_vault
      .provision(user_id, database)
      .catch(async (error) => {
        if (error === lib_error.vault_unavailable) throw error
        await Bun.sleep(vault_retry_delay_ms)
        return await service_vault.provision(user_id, database)
      })
      .finally(() => vault_pending.delete(user_id))
    vault_pending.set(user_id, provision)
    return await provision
  },

  async provision(user_id: number, database: vault_database) {
    const existing = await service_vault.find(user_id, database)
    if (existing) return existing
    const { url, auth_token } = process.env.TURSODB_URL!.startsWith('file:')
      ? provision_local(user_id)
      : await provision_turso(user_id)
    await apply_migration(url, vault_migration_directory, auth_token)
    const tenant = database.vault_db(url)
    const access = await tenant.access.findFirst({ where: { user_id, deleted_at: null } })
    if (!access) await tenant.access.create({ data: { user_id, actions: vault_owner_action } })
    return await database.main_db.vault
      .create({ data: { vault_owner_type, vault_owner_id: user_id, vault_database_url: url } })
      .catch(async (error) => {
        const raced = await service_vault.find(user_id, database)
        if (raced) return raced
        throw error
      })
  },
}
