import type { RedisClient } from 'bun'
import type { create_database_client } from '@db/client.db'
import { lib_error } from '@lib/error.lib'

const route_ttl_seconds = 3600

export const service_room_route = {
  async find(
    room_uid: string,
    database: ReturnType<typeof create_database_client>,
    redis: RedisClient,
  ) {
    const cached = await redis.get(`route:${room_uid}`)
    if (cached) return database.vault_db(cached)
    const route = await database.main_db.roomRoute.findFirst({
      where: { room_uid, deleted_at: null, vault: { deleted_at: null } },
      select: { vault: { select: { vault_database_url: true } } },
    })
    if (!route) throw lib_error.room_not_found
    await redis.set(`route:${room_uid}`, route.vault.vault_database_url, 'EX', route_ttl_seconds)
    return database.vault_db(route.vault.vault_database_url)
  },
}
