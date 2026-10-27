import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create_database_client } from '@db/client.db'
import { apply_migration } from '@db/utils.db'
import { lib_error } from '@lib/error.lib'
import { service_vault } from '@module/main/vault/vault.service'

const directory = mkdtempSync(join(tmpdir(), 'mawiid-vault-'))
const previous_env = { ...process.env }
let database: ReturnType<typeof create_database_client>

beforeAll(async () => {
  process.env.TURSODB_URL = `file:${join(directory, 'main.db')}`
  process.env.TURSODB_TOKEN = 'local'
  process.env.TURSODB_GROUP_TOKEN = 'local'
  await apply_migration(process.env.TURSODB_URL, join(import.meta.dir, '../../../../prisma/main/migrations'), 'local')
  database = create_database_client()
})

afterAll(async () => {
  await database.close()
  process.env = previous_env
  rmSync(directory, { recursive: true, force: true })
})

describe('service_vault.create with local databases', () => {
  test('creates a migrated vault file, grants room.create and records the vault', async () => {
    const vault = await service_vault.create(41, database)

    expect(vault).toMatchObject({ vault_owner_type: 'user', vault_owner_id: 41, vault_database_url: `file:${join(directory, 'vault-user-41.db')}` })
    expect(existsSync(join(directory, 'vault-user-41.db'))).toBe(true)
    const tenant = database.vault_db(vault.vault_database_url)
    expect(await tenant.access.findFirst({ where: { user_id: 41 } })).toMatchObject({ actions: ['room.create'] })
    expect(await tenant.room.count()).toBe(0)
  })

  test('returns the same vault on later calls', async () => {
    const first = await service_vault.create(42, database)
    const second = await service_vault.create(42, database)

    expect(second.vault_id).toBe(first.vault_id)
    expect(await database.main_db.vault.count({ where: { vault_owner_id: 42 } })).toBe(1)
  })

  test('keeps one vault when two requests race', async () => {
    const [first, second] = await Promise.all([service_vault.create(43, database), service_vault.create(43, database)])

    expect(second.vault_id).toBe(first.vault_id)
    expect(await database.main_db.vault.count({ where: { vault_owner_id: 43 } })).toBe(1)
    expect(await database.vault_db(first.vault_database_url).access.count({ where: { user_id: 43 } })).toBe(1)
  })
})

describe('service_vault.create across instances', () => {
  test('retries when another instance is creating the same vault', async () => {
    const [other, own] = await Promise.allSettled([service_vault.provision(46, database), service_vault.create(46, database)])

    expect(own.status).toBe('fulfilled')
    expect(await database.main_db.vault.count({ where: { vault_owner_id: 46 } })).toBe(1)
    if (other.status === 'fulfilled' && own.status === 'fulfilled') expect(own.value.vault_id).toBe(other.value.vault_id)
  })
})

describe('service_vault.create with Turso', () => {
  test('refuses without a Platform API token', async () => {
    const url = process.env.TURSODB_URL
    process.env.TURSODB_URL = 'libsql://main-org.turso.io'
    delete process.env.TURSODB_API_TOKEN
    const fetch_spy = spyOn(globalThis, 'fetch')
    const error_spy = spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(service_vault.create(44, database)).rejects.toEqual(lib_error.vault_unavailable)
      expect(fetch_spy).not.toHaveBeenCalled()
    } finally {
      process.env.TURSODB_URL = url
      fetch_spy.mockRestore()
      error_spy.mockRestore()
    }
  })

  test('reports a Turso API failure without recording a vault', async () => {
    const url = process.env.TURSODB_URL
    process.env.TURSODB_URL = 'libsql://main-org.turso.io'
    process.env.TURSODB_API_TOKEN = 'token'
    process.env.TURSODB_ORG = 'org'
    process.env.TURSODB_GROUP_NAME = 'mawiid-dev'
    const fetch_spy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('quota exceeded', { status: 500 }))
    const error_spy = spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(service_vault.create(45, database)).rejects.toEqual(lib_error.vault_unavailable)
      const [request_url, init] = fetch_spy.mock.calls[0]!
      expect(request_url).toBe('https://api.turso.tech/v1/organizations/org/databases')
      expect(JSON.parse(String(init?.body))).toEqual({ name: 'mawiid-dev-user-45', group: 'mawiid-dev' })
      expect(await service_vault.find(45, database)).toBeNull()
    } finally {
      process.env.TURSODB_URL = url
      fetch_spy.mockRestore()
      error_spy.mockRestore()
    }
  })
})
