import { create_database_client } from '@db/client.db'

const service_seed = {
  async create(database: ReturnType<typeof create_database_client>, tenant_url: string) {
    const tenant = database.vault_db(tenant_url)
    await database.main_db.vault.findFirst({ where: { deleted_at: null }, select: { vault_id: true } })
    await tenant.access.findFirst({ where: { deleted_at: null }, select: { access_id: true } })

    const users: { user_id: number; user_first_name: string }[] = []
    for (const name of ['Host', 'GuestOne', 'GuestTwo']) {
      const user_phone = `seed-room-${name.toLowerCase()}`
      const user = await database.main_db.user.findFirst({ where: { user_phone, deleted_at: null } })
        ?? await database.main_db.user.create({
          data: { user_phone, user_first_name: name, user_last_name: 'Test' },
        })
      users.push(user)
    }

    const host = users[0]!
    let vault = await database.main_db.vault.findFirst({
      where: { vault_owner_type: 'user', vault_owner_id: host.user_id, deleted_at: null },
    })
    if (vault && vault.vault_database_url !== tenant_url) {
      throw new Error('The seed host already has a different vault URL. Use that URL rather than redirecting its data.')
    }
    vault ??= await database.main_db.vault.create({
      data: { vault_owner_type: 'user', vault_owner_id: host.user_id, vault_database_url: tenant_url },
    })

    const access = await tenant.access.findFirst({ where: { user_id: host.user_id, deleted_at: null } })
    if (!access) {
      await tenant.access.create({ data: { user_id: host.user_id, actions: ['room.create'] } })
    } else {
      const actions = Array.isArray(access.actions) ? access.actions : []
      if (!actions.includes('room.create')) {
        await tenant.access.update({ where: { access_id: access.access_id }, data: { actions: [...actions, 'room.create'] } })
      }
    }

    return { users, vault }
  },
}

const tenant_url = process.argv[2]
if (!tenant_url || !process.env.TURSODB_URL) {
  throw new Error('Set TURSODB_URL in .env and run: bun run db:seed "<tenant_database_url>"')
}
if (tenant_url === process.env.TURSODB_URL) {
  throw new Error('The tenant database must be separate from the main TURSODB_URL database.')
}

const database = create_database_client()
try {
  const { users, vault } = await service_seed.create(database, tenant_url)
  console.table(users.map(({ user_id, user_first_name }) => ({ user_id, name: user_first_name })))
  console.log(`OpenAPI dev_user / x-user-id: ${users[0]!.user_id}`)
  console.log('POST /room body:')
  console.log(JSON.stringify({
    vault_id: vault.vault_id,
    room_title: 'Seed test meeting',
    user_ids: users.slice(1).map((user) => user.user_id),
  }, null, 2))
} finally {
  await database.close()
}
