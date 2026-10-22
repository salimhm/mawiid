import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'
import { apply_migration } from '@db/utils.db'
import { create_database_client } from '@db/client.db'

const directory = join(import.meta.dir, 'data')
const vault_url = `file:${join(directory, 'vault.db')}`
const backend = join(import.meta.dir, '..')
const seed_user = [
  { key: 'host', first_name: 'Hana', role: 'host', status: 'active' },
  { key: 'moderator', first_name: 'Malik', role: 'moderator', status: 'active' },
  { key: 'member', first_name: 'Mona', role: 'member', status: 'active' },
  { key: 'viewer', first_name: 'Vic', role: 'viewer', status: 'active' },
  { key: 'guest', first_name: 'Gus', role: 'member', status: 'invited' },
  { key: 'outsider', first_name: 'Omar', role: null, status: null },
]

function seed_jwt(user_id: number) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = encode({ alg: 'HS256', typ: 'JWT' })
  const body = encode({ user_id, exp: Math.floor(Date.now() / 1000) + 30 * 86400 })
  const signature = createHmac('sha256', process.env.JWT_SECRET_KEY!).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

rmSync(directory, { recursive: true, force: true })
mkdirSync(directory, { recursive: true })
await apply_migration(process.env.TURSODB_URL!, join(backend, 'prisma/main/migrations'), 'local')
await apply_migration(vault_url, join(backend, 'prisma/tenant/migrations'), 'local')

const database = create_database_client()
const room_uid = crypto.randomUUID()
const variable: Record<string, string> = {
  base_url: `http://localhost:${process.env.BACKEND_PORT || 3000}`,
  ws_url: `ws://localhost:${process.env.BACKEND_PORT || 3000}`,
  room_uid,
}
const user_id: Record<string, number> = {}
for (const [index, user] of seed_user.entries()) {
  const row = await database.main_db.user.create({
    data: { user_phone: `+2135500000${index}`, user_first_name: user.first_name, user_last_name: 'Test', user_language: 'en' },
  })
  user_id[user.key] = row.user_id
  variable[`user_${user.key}`] = String(row.user_id)
  variable[`token_${user.key}`] = seed_jwt(row.user_id)
}
const vault = await database.main_db.vault.create({
  data: { vault_owner_type: 'user', vault_owner_id: user_id.host!, vault_database_url: vault_url },
})
await database.main_db.roomRoute.create({ data: { room_uid, vault_id: vault.vault_id } })
const tenant = database.vault_db(vault_url)
const room = await tenant.room.create({
  data: {
    room_uid,
    room_title: 'Postman test live',
    room_type: 'group',
    room_status: 'open',
    room_visibility: 'private',
    room_max_participants: 12,
    user_id: user_id.host!,
  },
})
for (const user of seed_user) {
  if (!user.role || !user.status) continue
  await tenant.roomMember.create({
    data: { room_id: room.room_id, user_id: user_id[user.key]!, room_member_role: user.role, room_member_status: user.status },
  })
}
await database.close()

writeFileSync(
  join(import.meta.dir, 'mawiid.postman_environment.json'),
  JSON.stringify(
    {
      id: crypto.randomUUID(),
      name: 'Mawiid local',
      values: Object.entries(variable).map(([key, value]) => ({ key, value, type: key.startsWith('token_') ? 'secret' : 'default', enabled: true })),
      _postman_variable_scope: 'environment',
    },
    null,
    2,
  ),
)
console.log(`Seeded room ${room_uid}`)
console.table(seed_user.map((user) => ({ user: user.key, user_id: user_id[user.key], role: user.role ?? 'not a member', status: user.status ?? '' })))
console.log('Import postman/mawiid.postman_environment.json and postman/mawiid.postman_collection.json into Postman.')
